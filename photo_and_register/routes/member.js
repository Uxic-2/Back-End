const router = require('express').Router();

// 로그인 페이지 렌더링
router.get('/login', (req, res) => {
    res.render('login.ejs');
});

// 로그인 데이터 처리
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // 사용자가 입력한 이메일과 비밀번호로 데이터베이스에서 사용자 찾기
    const user = await req.db.collection('login').findOne({ email, pw: password });

    if (user) {
        // 로그인 성공 시
        res.status(200).send({ message: 'Login successful' });
    } else {
        // 로그인 실패 시
        res.status(401).send({ message: 'Invalid email or password' });
    }
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
            console.log('회원가입을 축하드립니다');
            res.status(200).send({ message: 'User registered successfully' }); // 상태 코드 200과 함께 응답
        }
    );
});

module.exports = router;
