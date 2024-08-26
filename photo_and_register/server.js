const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { MongoClient, GridFSBucket } = require('mongodb');
const Exif = require('exif').ExifImage;
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcrypt'); // bcrypt 모듈 추가

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
let db, photodb, bucket;

async function main() {
    try {
        const client = new MongoClient(db_url);
        await client.connect();
        db = client.db('db');
        photodb = client.db('photodb');
        bucket = new GridFSBucket(photodb, { bucketName: 'photo' });

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
    req.photodb = photodb;
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

// GET 요청 처리
app.get('/', (req, res) => res.render('main.ejs'));
app.get('/upload', (req, res) => res.render('upload', { message: null }));
app.get('/search', async (req, res) => {
    try {
        const photos = await photodb.collection('photo.files').find({}).toArray();
        const photoDetails = photos.map(photo => ({
            filename: photo.filename,
            address: photo.metadata ? photo.metadata.address : 'No address',
            likes: photo.metadata ? photo.metadata.likes : 0,
            timestamp: photo.metadata ? photo.metadata.timestamp : 'Unknown',
            gps: photo.metadata ? {
                latitude: photo.metadata.gps ? photo.metadata.gps.latitude : 'Unknown',
                longitude: photo.metadata.gps ? photo.metadata.gps.longitude : 'Unknown'
            } : { latitude: 'Unknown', longitude: 'Unknown' },
            uploadDate: photo.uploadDate.toISOString()
        }));
        res.render('search', { photos: photoDetails });
    } catch (err) {
        console.error('Error fetching photos:', err);
        res.render('search', { photos: [] });
    }
});
app.get('/image/:filename', (req, res) => {
    const downloadStream = bucket.openDownloadStreamByName(req.params.filename);
    downloadStream.pipe(res);
});
app.get('/location', (req, res) => {
    const address = req.query.address || 'Seoul, Korea';
    const latitude = parseFloat(req.query.latitude) || 37.5665;  // Default latitude for Seoul
    const longitude = parseFloat(req.query.longitude) || 126.978; // Default longitude for Seoul

    res.render('location', { address, latitude, longitude });
});

app.get('/mypage', (req, res) => {
    if (req.session && req.session.user) {
        res.render('mypage', { user: req.session.user });
    } else {
        res.redirect('/member/login');
    }
});

// POST 요청 처리
app.post('/upload', upload.single('uploadImg'), async (req, res) => {
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
    } : { latitude: 'Unknown', longitude: 'Unknown' };

    const uploadStream = bucket.openUploadStream(req.body.filename || 'default_name' + path.extname(req.file.originalname), {
        metadata: {
            address: req.body.address,
            likes: parseInt(req.body.likes) || 0,
            timestamp: timestamp,
            gps: gps
        }
    });
    fileStream.pipe(uploadStream)
        .on('finish', () => {
            fs.unlink(filePath, (err) => {
                if (err) console.error('Error deleting file:', err);
            });
            res.render('upload', { message: 'File uploaded and saved to MongoDB successfully.' });
        })
        .on('error', (error) => {
            console.error('Error uploading file to MongoDB:', error);
            res.render('upload', { message: 'Error uploading file.' });
        });
});

app.post('/delete-image/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const file = await photodb.collection('photo.files').findOne({ filename: filename });

        if (!file) {
            return res.status(404).send('File not found');
        }

        await photodb.collection('photo.files').deleteOne({ _id: file._id });
        await photodb.collection('photo.chunks').deleteMany({ files_id: file._id });

        res.redirect('/search');
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).send('Error deleting file');
    }
});

// 로그인 페이지 렌더링
app.get('/member/login', (req, res) => {
    res.render('login.ejs');
});

// 로그인 데이터 처리
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

        req.session.user = { id: user.id };

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

// 회원가입 데이터 처리
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
            pw: hashedPassword
        });

        console.log('User registered:', result.insertedId);
        res.status(200).send({ message: 'User registered successfully' });
    } catch (error) {
        console.error('Database Insert Error:', error);
        res.status(500).send({ message: 'Database Insert Error' });
    }
});

// 현재 로그인 상태를 반환하는 엔드포인트
app.get('/auth-status', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

module.exports = app;
