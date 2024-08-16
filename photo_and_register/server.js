const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { MongoClient, GridFSBucket } = require('mongodb');
const Exif = require('exif').ExifImage; // exif 패키지 추가

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));

const db_url = 'mongodb+srv://bhw119:YYLitUv8euBCtgxA@uxic.xsjkwl9.mongodb.net/?retryWrites=true&w=majority&appName=Uxic';
let db;
let bucket;

async function main() {
    try {
        const client = new MongoClient(db_url, { useUnifiedTopology: true });
        await client.connect();
        db = client.db('db');  // 'db'를 데이터베이스 이름으로 사용
        bucket = new GridFSBucket(db, { bucketName: 'photo' }); // GridFSBucket 설정

        console.log('Connected to database');
        app.listen(8080, () => {
            console.log('server on port 8080');
        });
    } catch (error) {
        console.error('Database connection error:', error);
    }
}

main().catch(console.error);

// MongoDB 인스턴스를 라우터에서 사용 가능하게 설정
app.use((req, res, next) => {
    req.db = db;
    req.bucket = bucket;
    next();
});

// 이미지 업로드 설정
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public', 'image'));
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// 메인 페이지
app.get('/', (req, res) => {
    res.render('index.ejs');
});

// 이미지 업로드 페이지 렌더링
app.get('/upload', (req, res) => {
    res.render('upload', { message: null });
});

// 이미지 업로드 처리
app.post('/upload', upload.single('uploadImg'), async (req, res) => {
    const filePath = path.join(__dirname, 'public', 'image', req.file.filename);
    const fileStream = fs.createReadStream(filePath);

    // EXIF 데이터 추출
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

    // EXIF 데이터에서 필요한 정보 추출
    const timestamp = exifData.exif ? exifData.exif.DateTimeOriginal : 'Unknown time';
    const gps = exifData.gps ? {
        latitude: exifData.gps.GPSLatitude,
        longitude: exifData.gps.GPSLongitude
    } : { latitude: 'Unknown', longitude: 'Unknown' };

    const uploadStream = bucket.openUploadStream(req.body.filename || 'default_name' + path.extname(req.file.originalname), {
        metadata: {
            address: req.body.address,
            likes: parseInt(req.body.likes) || 0, // likes 필드 추가, 기본값 0
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

// 검색 페이지에 모든 사진을 보여주는 엔드포인트
app.get('/search', async (req, res) => {
    try {
        const photos = await db.collection('photo.files').find({}).toArray();
        const photoDetails = photos.map(photo => ({
            filename: photo.filename,
            address: photo.metadata ? photo.metadata.address : 'No address',
            likes: photo.metadata ? photo.metadata.likes : 0,
            timestamp: photo.metadata ? photo.metadata.timestamp : 'Unknown',
            gps: photo.metadata ? photo.metadata.gps : { latitude: 'Unknown', longitude: 'Unknown' }
        }));
        res.render('search', { photos: photoDetails });
    } catch (err) {
        console.error('Error fetching photos:', err);
        res.render('search', { photos: [] });
    }
});

// 주소에 해당하는 파일 정보를 조회하고 카카오맵으로 표시
app.get('/location', async (req, res) => {
    const address = req.query.address || '';
    res.render('location', { address });
});

// 이미지 파일 조회
app.get('/image/:filename', (req, res) => {
    const downloadStream = bucket.openDownloadStreamByName(req.params.filename);
    downloadStream.pipe(res);
});

// 멤버 라우터 연결
app.use('/member', require('./routes/member.js'));

module.exports = app;
