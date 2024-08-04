const express = require('express');
const path = require('path');
const multer = require('multer');
const { MongoClient, GridFSBucket } = require('mongodb');
const fs = require('fs');
const app = express();

// Multer 설정: 디스크에 파일을 저장
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'public', 'image');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const userProvidedName = req.body.filename || 'default_name';
        const fileExtension = path.extname(file.originalname);
        cb(null, userProvidedName + fileExtension);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') {
            return cb(new Error('PNG, JPG만 업로드하세요'), false);
        }
        cb(null, true);
    }
});

// MongoDB 연결 문자열 및 설정
const mongoURI = 'mongodb+srv://bhw119:YYLitUv8euBCtgxA@uxic.xsjkwl9.mongodb.net/?retryWrites=true&w=majority&appName=Uxic';
let db, bucket;

MongoClient.connect(mongoURI)
    .then(client => {
        db = client.db('photodb');
        bucket = new GridFSBucket(db, { bucketName: 'photo' });
        console.log('Connected to MongoDB');
    })
    .catch(err => {
        console.error('Failed to connect to MongoDB', err);
    });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));

// 이미지 업로드 페이지 렌더링
app.get('/upload', (req, res) => {
    res.render('upload', { message: null }); // 초기 페이지 로드 시 메시지 없음
});

// 이미지 업로드 처리
app.post('/upload', upload.single('uploadImg'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const filePath = path.join(__dirname, 'public', 'image', req.file.filename);
    const fileStream = fs.createReadStream(filePath);

    const uploadStream = bucket.openUploadStream(req.body.filename || 'default_name' + path.extname(req.file.originalname), {
        metadata: {
            address: req.body.address
        }
    });
    fileStream.pipe(uploadStream);

    uploadStream.on('finish', async () => {
        fs.unlink(filePath, (err) => {
            if (err) console.error('Error deleting file:', err);
        });

        // 업로드 성공 메시지를 전달
        res.render('upload', { message: 'File uploaded and saved to MongoDB successfully.' });
    });

    uploadStream.on('error', (err) => {
        console.error('Error uploading file to MongoDB:', err);
        res.status(500).send('Error uploading file to MongoDB.');
    });
});

// 검색 페이지에 모든 사진을 보여주는 엔드포인트
app.get('/search', async (req, res) => {
    try {
        // MongoDB에서 'photo.files' 컬렉션을 조회하여 파일 목록을 가져옵니다.
        const photos = await db.collection('photo.files').find({}).toArray();
        
        // 각 파일의 정보와 메타데이터를 조회합니다.
        const photoDetails = photos.map(photo => ({
            filename: photo.filename,
            address: photo.metadata ? photo.metadata.address : 'No address'
        }));

        // EJS 템플릿에 데이터를 전달하여 페이지를 렌더링합니다.
        res.render('search', { photos: photoDetails });
    } catch (err) {
        console.error('Error fetching photos:', err);
        res.status(500).send('Error fetching photos.');
    }
});

// 사진 파일 스트리밍 처리
app.get('/image/:filename', (req, res) => {
    const filename = req.params.filename;
    const downloadStream = bucket.openDownloadStreamByName(filename);

    downloadStream.on('data', (chunk) => {
        res.write(chunk);
    });

    downloadStream.on('end', () => {
        res.end();
    });

    downloadStream.on('error', (err) => {
        console.error('Error streaming file:', err);
        res.status(404).send('File not found.');
    });
});

// 주소에 해당하는 파일 정보를 조회하고 카카오맵으로 표시
app.get('/location', async (req, res) => {
    const address = req.query.address || ''; // 쿼리 파라미터에서 주소를 가져옵니다
    res.render('location', { address });
});

// 서버 시작
const PORT = 8080;
app.listen(PORT, () => {
    console.log(`App is listening on port ${PORT}`);
});
