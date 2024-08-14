const express = require('express');
const app = express();
const MongoClient = require('mongodb').MongoClient;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());  // JSON 요청을 파싱하기 위해 추가

const db_url = 'mongodb+srv://bhw119:YYLitUv8euBCtgxA@uxic.xsjkwl9.mongodb.net/?retryWrites=true&w=majority&appName=Uxic';

let db;

async function main() {
    try {
        const client = new MongoClient(db_url, { useUnifiedTopology: true });
        await client.connect();
        db = client.db('db');  // 'db'를 데이터베이스 이름으로 사용
        console.log('Connected to database');

        app.listen(8080, () => {
            console.log('server on port 8080');
        });
    } catch (error) {
        console.error('Database connection error:', error);
    }
}

main().catch(console.error);

app.set('view engine', 'ejs');

// MongoDB 인스턴스를 라우터에서 사용 가능하게 설정
app.use((req, res, next) => {
    req.db = db;
    next();
});

app.get('/', (req, res) => {
    res.render('index.ejs');
});

app.use('/member', require('./routes/member.js'));

module.exports = app;
