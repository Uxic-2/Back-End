const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { MongoClient, GridFSBucket } = require('mongodb');
const Exif = require('exif').ExifImage;
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const axios = require('axios'); // 주소를 위도와 경도로 변환하기 위한 axios 추가

const app = express();

// 공통 미들웨어 설정
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
}));

// 세션 설정
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

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

// 공통 미들웨어에 DB와 GridFSBucket 추가
app.use((req, res, next) => {
    req.db = db;
    req.bucket = bucket;
    next();
});

// Ensure the upload directory exists
const uploadDir = path.join(__dirname, 'public', 'image');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// 로그인 확인 미들웨어
const ensureAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/member/login?error=' + encodeURIComponent('로그인이 필요합니다.'));
};

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

// GET 요청 처리
app.get('/', (req, res) => res.render('main.ejs'));

app.get('/upload', async (req, res) => {
    try {
        // 데이터베이스에서 모든 사진 파일 조회
        const photos = await db.collection('photo.files').find({}).toArray();

        // 템플릿으로 photos 변수와 함께 렌더링
        res.render('upload', { 
            message: null, // 업로드 후 성공 메시지를 표시하려면 여기에 전달
            photos: photos
        });
    } catch (error) {
        console.error('오류:', error);
        res.status(500).send('서버 오류');
    }
});


app.get('/search', ensureAuthenticated, async (req, res) => {
    try {
        const photos = await db.collection('photo.files').find({}).toArray();
        const photoDetails = photos.map(photo => ({
            filename: photo.filename,
            address: photo.metadata ? photo.metadata.address : 'No address',
            likes: photo.metadata ? photo.metadata.likes : 0,
            timestamp: photo.metadata ? photo.metadata.timestamp : 'Unknown',
            gps: photo.metadata ? {
                latitude: photo.metadata.gps ? photo.metadata.gps.latitude : 'Unknown',
                longitude: photo.metadata.gps ? photo.metadata.gps.longitude : 'Unknown'
            } : { latitude: 'Unknown', longitude: 'Unknown' },
            uploadDate: photo.uploadDate.toISOString(),
        }));
        res.render('search', { photos: photoDetails });
    } catch (err) {
        console.error('Error fetching photos:', err);
        res.render('search', { photos: [] });
    }
});

app.get('/image/:filename', ensureAuthenticated, (req, res) => {
    const downloadStream = bucket.openDownloadStreamByName(req.params.filename);
    downloadStream.pipe(res);
});

// /location 경로 수정
app.get('/location', async (req, res) => {
    const address = req.query.address || 'Seoul, Korea';
    const latitude = parseFloat(req.query.latitude) || 37.5665;
    const longitude = parseFloat(req.query.longitude) || 126.978;
    const userId = req.session.user ? req.session.user.id : null;

    try {
        const user = await db.collection('users').findOne({ id: userId });
        const likedPlaceIds = user ? user.liked_placeid : [];

        res.render('location', { address, latitude, longitude, userId, likedPlaceIds });
    } catch (err) {
        console.error('Error fetching user data:', err);
        res.render('location', { address, latitude, longitude, userId, likedPlaceIds: [] });
    }
});



app.get('/mypage', ensureAuthenticated, (req, res) => {
    res.render('mypage', { user: req.session.user });
});

// 내 여행 폴더 페이지 렌더링
app.get('/mypage/folder', ensureAuthenticated, async (req, res) => {
    const userId = req.session.user.id;

    try {
        // 데이터베이스에서 사용자의 여행 폴더 정보를 가져옵니다.
        const user = await db.collection('users').findOne({ id: userId });

        if (!user) {
            return res.status(404).send('User not found');
        }

        // 사용자의 여행 폴더 정보를 가져와서 렌더링합니다.
        res.render('folder', { user, travelFolders: user.travel_folders || [] });
    } catch (error) {
        console.error('Error fetching travel folders:', error);
        res.status(500).send('Error fetching travel folders');
    }
});


// POST 요청 처리
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
        console.error('Error extracting EXIF data:', error);
    }

    // 위도와 경도 변환 함수
    const convertDMSToDecimal = (dms, ref) => {
        if (!dms || !ref) return 0;

        const [degrees, minutes, seconds] = dms;
        let decimal = degrees + (minutes / 60) + (seconds / 3600);
        return (ref === 'S' || ref === 'W') ? -decimal : decimal;
    };

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
            likes: parseInt(req.body.likes) || 0,
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

            // 응답을 한 번만 보내도록 보장
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


app.post('/update-like', ensureAuthenticated, async (req, res) => {
    const { photoId, action } = req.body;
    const userId = req.session.user.id;

    if (!photoId || !action || !['add', 'remove'].includes(action)) {
        return res.status(400).send({ message: 'Invalid request' });
    }

    try {
        const photo = await db.collection('photo.files').findOne({ _id: new MongoClient.ObjectId(photoId) });
        if (!photo) {
            return res.status(404).send({ message: 'Photo not found' });
        }

        let updatePhoto;
        let updateUser;
        
        if (action === 'add') {
            if (!photo.metadata.liked_by || !photo.metadata.liked_by.includes(userId)) {
                updatePhoto = {
                    $inc: { 'metadata.likes': 1 },
                    $push: { 'metadata.liked_by': userId }
                };
                updateUser = {
                    $push: { liked_photoid: photoId }
                };
            }
        } else if (action === 'remove') {
            if (photo.metadata.liked_by && photo.metadata.liked_by.includes(userId)) {
                updatePhoto = {
                    $inc: { 'metadata.likes': -1 },
                    $pull: { 'metadata.liked_by': userId }
                };
                updateUser = {
                    $pull: { liked_photoid: photoId }
                };
            }
        }

        if (updatePhoto) {
            await db.collection('photo.files').updateOne({ _id: new MongoClient.ObjectId(photoId) }, updatePhoto);
        }

        if (updateUser) {
            await db.collection('users').updateOne({ id: userId }, updateUser);
        }

        res.status(200).send({ message: 'Like status updated' });
    } catch (error) {
        console.error('Error updating like status:', error);
        res.status(500).send({ message: 'Internal server error' });
    }
});

// 로그인 페이지 렌더링
app.get('/member/login', (req, res) => {
    res.render('login.ejs', { error: req.query.error });
});

// 로그인 데이터 처리
app.post('/member/login', async (req, res) => {
    const { name, id, pw } = req.body;

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
        console.error('Error during login:', error);
        res.status(500).send({ message: 'Server error' });
    }
});

// 로그아웃 처리
app.get('/member/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).send('Error logging out.');
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
        return res.status(400).send({ message: 'All fields are required' });
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
            liked_placeid: []
        });

        console.log('User registered:', result.insertedId);
        res.status(200).send({ message: 'User registered successfully' });
    } catch (error) {
        console.error('Database Insert Error:', error);
        res.status(500).send({ message: 'Database Insert Error' });
    }
});

app.get('/auth-status', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// 장소 좋아요 추가 및 삭제 라우트
app.post('/places/:action', async (req, res) => {
    const { placeId, userId } = req.body;
    const action = req.params.action;

    if (!placeId || !userId || !action) {
        return res.status(400).send({ message: 'placeId, userId, action are required' });
    }

    try {
        const user = await db.collection('users').findOne({ id: userId });

        if (!user) {
            return res.status(404).send({ message: 'User not found' });
        }

        let update;

        if (action === 'add') {
            if (!user.liked_placeid.includes(placeId)) {
                update = { $push: { liked_placeid: placeId } };
            }
        } else if (action === 'remove') {
            if (user.liked_placeid.includes(placeId)) {
                update = { $pull: { liked_placeid: placeId } };
            }
        } else {
            return res.status(400).send({ message: 'Invalid action' });
        }

        if (update) {
            await db.collection('users').updateOne({ id: userId }, update);
            const updatedUser = await db.collection('users').findOne({ id: userId });
            return res.status(200).send({ message: 'Success', liked_placeid: updatedUser.liked_placeid });
        } else {
            return res.status(200).send({ message: 'No change' });
        }
    } catch (error) {
        console.error('Error updating liked places:', error);
        return res.status(500).send({ message: 'Internal server error' });
    }
});
// 사진 삭제 처리
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
app.get('/schedule', (req, res) => {
    res.render('schedule'); 
});

app.get('/recommend', async (req, res) => {
    const address = req.query.address || 'Seoul, Korea';
    const latitude = parseFloat(req.query.latitude) || 37.5665;
    const longitude = parseFloat(req.query.longitude) || 126.978;
    const userId = req.session.user ? req.session.user.id : null;

    try {
        const user = await db.collection('users').findOne({ id: userId });
        const likedPlaceIds = user ? user.liked_placeid : [];

        res.render('recommend', { address, latitude, longitude, userId, likedPlaceIds });
    } catch (err) {
        console.error('Error fetching user data:', err);
        res.render('recommend', { address, latitude, longitude, userId, likedPlaceIds: [] });
    }
});

module.exports = app;