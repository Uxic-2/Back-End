const router = require('express').Router();

// 로그인 페이지 렌더링
router.get('/login', (req, res) => {
    res.render('login.ejs');
});

// 회원가입 페이지 렌더링
router.get('/register', (req, res) => {
    res.render('register.ejs');
});

// 회원가입 데이터 처리
router.post('/register', (req, res) => {
    console.log('in register post');
    
    const { name, phone, birthdate, email, id, pw } = req.body;

    // 모든 필드가 유효한지 확인
    if (!name || !phone || !birthdate || !email || !id || !pw) {
        return res.status(400).send({ message: 'All fields are required' });
    }

    // 데이터베이스에 새로운 유저 삽입
    req.db.collection('login').insertOne(
        { name, phone, birthdate, email, id, pw },
        (error, result) => {
            if (error) {
                console.error('Database Insert Error:', error);
                return res.status(500).send({ message: 'Database Insert Error' });
            }
            console.log('User registered:', result.insertedId);
            res.status(200).send({ message: 'User registered successfully' });
        }
    );
});

module.exports = router;
