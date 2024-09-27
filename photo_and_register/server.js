const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const Exif = require('exif').ExifImage;
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const axios = require('axios'); // 주소를 위도와 경도로 변환하기 위한 axios 추가
const app = express();

// ===== 공통 미들웨어 설정 =====
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
}));
app.use((req, res, next) => {
    req.db = db;
    req.bucket = bucket;
    next();
});
// 로그인 확인 미들웨어
const ensureAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/member/login?error=' + encodeURIComponent('로그인이 필요합니다.'));
};

// 세션 설정
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// ===== 데이터베이스 연결 설정 =====
const db_url = 'mongodb+srv://bhw119:YYLitUv8euBCtgxA@uxic.xsjkwl9.mongodb.net/?retryWrites=true&w=majority&appName=Uxic';
let db, bucket;

async function main() {
    try {
        const client = new MongoClient(db_url);
        await client.connect();
        db = client.db('db');
        bucket = new GridFSBucket(db, { bucketName: 'photo' });

        console.log('Connected to databases');
        app.listen(8080, () => {
            console.log('Server is running on port 8080');
        });
    } catch (error) {
        console.error('Database connection error:', error);
    }
}

main().catch(console.error);

// ===== 파일 업로드 설정 =====
// 사진 업로드시 디렉토리 존재 설정(없으면 생성)
const uploadDir = path.join(__dirname, 'public', 'image');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// 주소에서 위도와 경도를 받아오는 함수
async function getLatLngFromAddress(address) {
    try {
        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                q: address,
                format: 'json',
                limit: 1
            }
        });

        if (response.data.length > 0) {
            const { lat, lon } = response.data[0];
            return { latitude: parseFloat(lat), longitude: parseFloat(lon) };
        } else {
            return { latitude: null, longitude: null };
        }
    } catch (error) {
        console.error('Error getting latitude and longitude from address:', error);
        return { latitude: null, longitude: null };
    }
}

// ===== 메인 페이지 =====
app.get('/', (req, res) => res.render('main.ejs'));

// ===== 업로드 페이지 =====
// 업로드 페이지 렌더링
app.get('/upload', ensureAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        // Fetch the user's uploaded photo IDs
        const user = await db.collection('users').findOne({ id: userId });
        const uploadedPhotoIds = user.uploaded_photoid.map(id => new ObjectId(id));

        // Fetch only the photos the user uploaded
        const photos = await db.collection('photo.files').find({ _id: { $in: uploadedPhotoIds } }).toArray();

        res.render('upload', { 
            message: null,
            photos: photos
        });
    } catch (error) {
        console.error('Error fetching photos:', error);
        res.status(500).send('Server error');
    }
});

// 업로드 처리
app.post('/upload', ensureAuthenticated, upload.single('uploadImg'), async (req, res) => {
    const filePath = path.join(uploadDir, req.file.filename);
    const fileStream = fs.createReadStream(filePath);

    let exifData = {};
    try {
        exifData = await new Promise((resolve, reject) => {
            new Exif({ image: filePath }, (error, exif) => {
                if (error) {
                    return reject(error);
                }
                resolve(exif);
            });
        });
    } catch (error) {
        console.error('EXIF 데이터 추출 오류:', error);
    }

    // 위도와 경도 변환 함수
    const convertDMSToDecimal = (dms, ref) => {
        if (!dms || !ref) return 0;

        const [degrees, minutes, seconds] = dms;
        let decimal = degrees + (minutes / 60) + (seconds / 3600);
        return (ref === 'S' || ref === 'W') ? -decimal : decimal;
    };
    const likes = parseInt(req.body.likes) || 0;
    const timestamp = exifData.exif ? exifData.exif.DateTimeOriginal : 'Unknown time';
    const gps = exifData.gps ? {
        latitude: convertDMSToDecimal(exifData.gps.GPSLatitude, exifData.gps.GPSLatitudeRef),
        longitude: convertDMSToDecimal(exifData.gps.GPSLongitude, exifData.gps.GPSLongitudeRef)
    } : { latitude: null, longitude: null };

    // EXIF 데이터에 GPS 정보가 없는 경우 주소를 기반으로 위도와 경도 계산
    if (gps.latitude === null || gps.longitude === null) {
        const address = req.body.address;
        if (address) {
            const { latitude, longitude } = await getLatLngFromAddress(address);
            gps.latitude = latitude;
            gps.longitude = longitude;
        }
    }

    const uploadStream = bucket.openUploadStream(req.body.filename || 'default_name' + path.extname(req.file.originalname), {
        metadata: {
            address: req.body.address,
            timestamp: timestamp,
            gps: gps
        }
    });

    uploadStream.on('finish', async () => {
        try {
            // 파일이 업로드된 후 임시 파일 삭제
            fs.unlink(filePath, (err) => {
                if (err) console.error('파일 삭제 오류:', err);
            });

            const uploadedFileId = uploadStream.id.toString();
            const userId = req.session.user.id;
            await db.collection('users').updateOne(
                { id: userId },
                { $push: { uploaded_photoid: uploadedFileId } }
            );

            res.redirect('/upload');
        } catch (error) {
            console.error('오류:', error);
            if (!res.headersSent) {
                res.status(500).send('서버 오류');
            }
        }
    });

    fileStream.pipe(uploadStream)
        .on('finish', () => {
            fs.unlink(filePath, (err) => {
                if (err) console.error('파일 삭제 오류:', err);
            });
        })
        .on('error', (err) => {
            console.error('파일 업로드 오류:', err);
            if (!res.headersSent) {
                res.status(500).send('서버 오류');
            }
        });
});

// ===== 로그인 및 회원가입 =====
// 로그인 페이지 렌더링
app.get('/member/login', (req, res) => {
    res.render('login.ejs', { error: req.query.error });
});

// 로그인 처리
app.post('/member/login', async (req, res) => {
    const { id, pw } = req.body;

    try {
        const user = await db.collection('users').findOne({ id });

        if (!user) {
            return res.redirect('/member/login?error=' + encodeURIComponent('없는 아이디 입니다.'));
        }

        const isMatch = await bcrypt.compare(pw, user.pw);

        if (!isMatch) {
            return res.redirect('/member/login?error=' + encodeURIComponent('비밀번호가 잘못되었습니다.'));
        }

        req.session.user = { id: user.id, name: user.name };

        res.redirect('/');
    } catch (error) {
        console.error('로그인 중 오류:', error);
        res.status(500).send({ message: '서버 오류' });
    }
});

// 로그아웃 처리
app.get('/member/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('세션 종료 오류:', err);
            return res.status(500).send('로그아웃 중 오류 발생.');
        }
        res.redirect('/');
    });
});

// 회원가입 페이지 렌더링
app.get('/member/register', (req, res) => {
    res.render('register.ejs');
});

// 회원가입 처리
app.post('/member/register', async (req, res) => {
    const { name, phone, birthdate, email, id, pw } = req.body;

    if (!name || !phone || !birthdate || !email || !id || !pw) {
        return res.status(400).send({ message: '모든 필드를 입력해주세요' });
    }

    try {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(pw, salt);

        const result = await db.collection('users').insertOne({
            name,
            phone,
            birthdate,
            email,
            id,
            pw: hashedPassword,
            uploaded_photoid: [],
            liked_photoid: [],
            liked_placeid: [],
            latitude: [],
            longitude: []
        });

        console.log('User registered:', result.insertedId);
        res.status(200).send({ message: '회원가입 성공' });
    } catch (error) {
        console.error('데이터베이스 삽입 오류:', error);
        res.status(500).send({ message: '데이터베이스 삽입 오류' });
    }
});

// 인증 상태 확인
app.get('/auth-status', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// ===== 검색 페이지 =====
app.get('/search', ensureAuthenticated, async (req, res) => {
    const userId = req.session.user.id;
    try {
        const user = await db.collection('users').findOne({ id: userId });
        const likedPhotoIds = user ? user.liked_photoid.map(id => id.toString()) : [];
        const photos = await db.collection('photo.files').find({}).toArray();
        const photoDetails = photos.map(photo => ({
            _id: photo._id.toString(),
            filename: photo.filename,
            address: photo.metadata ? photo.metadata.address : 'No address',
            likes: photo.metadata ? photo.likes : 0,
            timestamp: photo.metadata ? photo.metadata.timestamp : 'Unknown',
            gps: photo.metadata ? {
                latitude: photo.metadata.gps ? photo.metadata.gps.latitude : 'Unknown',
                longitude: photo.metadata.gps ? photo.metadata.gps.longitude : 'Unknown'
            } : { latitude: 'Unknown', longitude: 'Unknown' },
            uploadDate: photo.uploadDate.toISOString(),
        }));
        res.render('search', { photos: photoDetails, userId, likedPhotoIds });
    } catch (err) {
        console.error('사진 가져오기 오류:', err);
        res.render('search', { photos: [], userId: null, likedPhotoIds: [] });
    }
});

// 이미지 제공
app.get('/image/:filename', ensureAuthenticated, (req, res) => {
    const downloadStream = bucket.openDownloadStreamByName(req.params.filename);
    downloadStream.pipe(res);
});

// ===== 위치 페이지 =====
app.get('/location', ensureAuthenticated, async (req, res) => {
    const address = req.query.address || 'Seoul, Korea';
    const latitude = parseFloat(req.query.latitude) || 37.5665;
    const longitude = parseFloat(req.query.longitude) || 126.978;
    const userId = req.session.user.id;

    try {
        const user = await db.collection('users').findOne({ id: userId });
        const likedPlaceIds = user ? user.liked_placeid : [];

        res.render('location', { address, latitude, longitude, userId, likedPlaceIds });
    } catch (err) {
        console.error('사용자 데이터 가져오기 오류:', err);
        res.render('location', { address, latitude, longitude, userId, likedPlaceIds: [] });
    }
});

// ===== 마이페이지 =====
app.get('/mypage', ensureAuthenticated, (req, res) => {
    res.render('mypage', { user: req.session.user });
});

// 내 여행 폴더 페이지
app.get('/mypage/folder', async (req, res) => {
    try {
        const userId = req.session.user.id;
        const user = await db.collection('users').findOne({ id: userId });

        // 사용자 좋아요 장소 목록 가져오기 (object를 배열로 변환)
        const likedPlaces = Object.keys(user.place_names).map(key => ({
            placeId: key,
            place_name: user.place_names[key],
        }));

        res.render('folder', { likedPlaces }); // EJS로 데이터 전달
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});


// ===== 사진 삭제 처리 =====

app.get('/delete-image/:filename', ensureAuthenticated, async (req, res) => {
    try {
        const filename = req.params.filename;
        const file = await db.collection('photo.files').findOne({ filename: filename });

        if (!file) {
            return res.status(404).send('File not found');
        }

        await db.collection('photo.files').deleteOne({ _id: file._id });
        await db.collection('photo.chunks').deleteMany({ files_id: file._id });

        // 파일 삭제 후 사진 목록 가져오기
        const photos = await db.collection('photo.files').find({}).toArray();
        const photoDetails = photos.map(photo => ({
            filename: photo.filename,
        }));

        res.render('upload', { message: 'File deleted successfully.', photos: photoDetails });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).send('Error deleting file');
    }
});

app.post('/delete-image/:filename', ensureAuthenticated, async (req, res) => {
    try {
        const filename = req.params.filename;
        const userId = req.session.user.id;

        // 사진 파일 정보 찾기
        const file = await db.collection('photo.files').findOne({ filename: filename });

        if (!file) {
            return res.status(404).send('File not found');
        }

        // 파일 삭제
        await db.collection('photo.files').deleteOne({ _id: file._id });
        await db.collection('photo.chunks').deleteMany({ files_id: file._id });

        // 파일 _id를 ObjectId 타입으로 변환
        const fileId = file._id;

        // 사용자 문서에서 해당 사진의 ID를 삭제
        const updateResult = await db.collection('users').updateOne(
            { id: userId },
            { $pull: { uploaded_photoid: fileId } }
        );

        if (updateResult.modifiedCount === 0) {
            console.warn('No documents matched the query or no changes were made.');
        }

        // 삭제 후 사진 목록 업데이트
        const photos = await db.collection('photo.files').find({}).toArray();
        const photoDetails = photos.map(photo => ({
            filename: photo.filename,
        }));

        res.render('upload', { message: 'File deleted successfully.', photos: photoDetails });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).send('Error deleting file');
    }
});

// ===== 좋아요 기능 =====

// 장소 좋아요 추가 및 삭제(name만 가져오는거 아래는)
app.post('/places/:action', ensureAuthenticated, async (req, res) => {
    const { placeId, place_name } = req.body; 
    const action = req.params.action;
    const userId = req.session.user.id;

    if (!placeId || !place_name || !action || !userId) {
        return res.status(400).send({ message: 'placeId, place_name, userId, action이 필요합니다.' });
    }

    try {
        const user = await db.collection('users').findOne({ id: userId });

        if (!user) {
            return res.status(404).send({ message: '사용자를 찾을 수 없습니다.' });
        }

        let update;

        if (action === 'add') {
            if (!user.liked_placeid.includes(placeId)) {
                // liked_placeid에 placeId 추가하고, place_name도 db에 저장
                update = { 
                    $push: { liked_placeid: placeId },
                    $set: { [`place_names.${placeId}`]: place_name } // place_names 객체에 place_name 추가
                };
            }
        } else if (action === 'remove') {
            if (user.liked_placeid.includes(placeId)) {
                // liked_placeid에서 placeId 제거하고, place_name도 삭제
                update = { 
                    $pull: { liked_placeid: placeId },
                    $unset: { [`place_names.${placeId}`]: "" } // place_names에서 place_name 제거
                };
            }
        } else {
            return res.status(400).send({ message: '유효하지 않은 액션입니다.' });
        }

        if (update) {
            await db.collection('users').updateOne({ id: userId }, update);
            const updatedUser = await db.collection('users').findOne({ id: userId });
            return res.status(200).send({ message: '성공', liked_placeid: updatedUser.liked_placeid });
        } else {
            return res.status(200).send({ message: '변경 사항 없음' });
        }
    } catch (error) {
        console.error('장소 좋아요 업데이트 오류:', error);
        return res.status(500).send({ message: '서버 내부 오류' });
    }
});


// 사진 좋아요 추가 및 삭제
app.post('/photos/:action', async (req, res) => {
    const { photoId } = req.body;
    const userId = req.session.user.id; 
    const action = req.params.action;

    if (!photoId || !userId || !action) {
        console.log('Missing data:', { photoId, userId, action });
        return res.status(400).send({ message: 'photoId, userId, action are required' });
    }

    try {
        const user = await db.collection('users').findOne({ id: userId });
        const photoObjectId = new ObjectId(photoId); // ObjectId로 변환

        if (!user) {
            return res.status(404).send({ message: 'User not found' });
        }

        let userUpdate, photoUpdate;

        if (action === 'add') {
            // 좋아요 추가
            if (!user.liked_photoid.includes(photoObjectId.toString())) { // 문자열로 변환 후 비교
                userUpdate = { $push: { liked_photoid: photoObjectId.toString() } }; // 문자열로 저장
                photoUpdate = { $inc: { 'likes': 1 } }; // 'likes' 필드 업데이트
            } else {
                return res.status(400).send({ message: '이미 좋아요를 누른 사진입니다.' });
            }
        } else if (action === 'remove') {
            // 좋아요 제거
            if (user.liked_photoid.includes(photoObjectId.toString())) { // 문자열로 변환 후 비교
                userUpdate = { $pull: { liked_photoid: photoObjectId.toString() } }; // 문자열로 저장
                photoUpdate = { $inc: { 'likes': -1 } }; // 'likes' 필드 업데이트
            } else {
                return res.status(400).send({ message: '좋아요를 누르지 않은 사진입니다.' });
            }
        } else {
            return res.status(400).send({ message: 'Invalid action' });
        }

        // 유저의 liked_photoid 업데이트
        await db.collection('users').updateOne({ id: userId }, userUpdate);

        // photo.files 컬렉션의 좋아요 수 업데이트
        await db.collection('photo.files').updateOne({ _id: photoObjectId }, photoUpdate);

        res.status(200).send({ message: `사진에 좋아요를 ${action === 'add' ? '추가' : '제거'}했습니다.` });
    } catch (error) {
        console.error('좋아요 처리 중 오류:', error);
        res.status(500).send({ message: '서버 오류가 발생했습니다.' });
    }
});


// ===== 스케줄 페이지 =====
app.get('/schedule', ensureAuthenticated, (req, res) => {
    res.render('schedule'); 
});

// ===== 추천 페이지 =====
app.get('/recommend', ensureAuthenticated, async (req, res) => {
    const address = req.query.address || 'Seoul, Korea';
    const latitude = parseFloat(req.query.latitude) || 37.5665;
    const longitude = parseFloat(req.query.longitude) || 126.978;
    const userId = req.session.user.id;

    try {
        const user = await db.collection('users').findOne({ id: userId });
        const likedPlaceIds = user ? user.liked_placeid : [];

        res.render('recommend', { address, latitude, longitude, userId, likedPlaceIds });
    } catch (err) {
        console.error('사용자 데이터 가져오기 오류:', err);
        res.render('recommend', { address, latitude, longitude, userId, likedPlaceIds: [] });
    }
});

module.exports = app;