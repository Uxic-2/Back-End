const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { MongoClient, GridFSBucket } = require('mongodb');
const Exif = require('exif').ExifImage;
const cors = require('cors');
const session = require('express-session'); // 세션 모듈 추가
const app = express();

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
    secret: 'your_secret_key', // 비밀 키 설정
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // 개발 중에는 false, 실제 배포 시에는 true로 설정
}));

const db_url = 'mongodb+srv://bhw119:YYLitUv8euBCtgxA@uxic.xsjkwl9.mongodb.net/?retryWrites=true&w=majority&appName=Uxic';
let db, photodb;
let bucket;

async function main() {
    try {
        const client = new MongoClient(db_url);
        await client.connect();
        db = client.db('db'); // 기본 db 연결
        photodb = client.db('photodb'); // 사진을 저장할 photodb 연결
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
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

app.get('/', (req, res) => {
    res.render('index.ejs');
});

app.get('/upload', (req, res) => {
    res.render('upload', { message: null });
});

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

    const timestamp = exifData.exif ? exifData.exif.DateTimeOriginal : 'Unknown time';
    const gps = exifData.gps ? {
        latitude: exifData.gps.GPSLatitude,
        longitude: exifData.gps.GPSLongitude
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

app.get('/search', async (req, res) => {
    try {
        // photodb에서 모든 사진 파일 정보를 가져옴
        const photos = await photodb.collection('photo.files').find({}).toArray();

        // 사진의 세부 정보를 변환
        const photoDetails = photos.map(photo => ({
            filename: photo.filename,
            address: photo.metadata ? photo.metadata.address : 'No address',
            likes: photo.metadata ? photo.metadata.likes : 0,
            timestamp: photo.metadata ? photo.metadata.timestamp : 'Unknown',
            gps: photo.metadata ? {
                latitude: (photo.metadata.gps && photo.metadata.gps.latitude) ? photo.metadata.gps.latitude.join(' ') : 'Unknown',
                longitude: (photo.metadata.gps && photo.metadata.gps.longitude) ? photo.metadata.gps.longitude.join(' ') : 'Unknown'
            } : { latitude: 'Unknown', longitude: 'Unknown' },
            uploadDate: photo.uploadDate.toISOString() // 날짜를 ISO 형식으로 변환
        }));

        res.render('search', { photos: photoDetails });
    } catch (err) {
        console.error('Error fetching photos:', err);
        res.render('search', { photos: [] });
    }
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

app.get('/image/:filename', (req, res) => {
    const downloadStream = bucket.openDownloadStreamByName(req.params.filename);
    downloadStream.pipe(res);
});

app.use('/member', require('./routes/member.js'));

// 등록 처리 라우트 추가
app.get('/register', (req, res) => {
    res.render('register', { message: null });
});

app.post('/register', async (req, res) => {
    try {
        const { username, email } = req.body;
        const result = await db.collection('users').insertOne({ username, email });

        res.render('register', { message: 'User registered successfully!' });
    } catch (error) {
        console.error('Error registering user:', error);
        res.render('register', { message: 'Error registering user.' });
    }
});

app.get('/location', (req, res) => {
    const address = req.query.address || 'Seoul, Korea'; // 주소가 제공되지 않으면 기본값으로 'Seoul, Korea' 사용
    res.render('location', { address });
});

// mypage
app.get('/mypage', (req, res) => {
    if (req.session && req.session.user) {
        // 로그인 상태인 경우
        res.render('mypage', { user: req.session.user });
    } else {
        // 로그인 상태가 아닌 경우
        res.redirect('/member/login');
    }
});



module.exports = app;
