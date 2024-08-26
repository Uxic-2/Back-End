var router = require('express').Router();
const user = require("../models/user");  // User model 불러오기
const bcrypt = require('bcrypt');  // 암호화 모듈

// 로그인 페이지 렌더링
router.get('/login', (req, res) => {
    res.render('login.ejs');
});

// 로그인 데이터 처리
// router.post('/login', async (req, res) => {
//     db.collection('login').findOne({id: id}, (error, result)=>{
//         if(result) {
//             let enc_pw = result.pw;
//             bcrypt.compare(pw, enc_pw, (error, result)=>{
//                 try{
//                     if(result) {
//                         res.send({
//                             code: 1
//                         });
//                     } else {
//                         res.send({
//                             code: 0
//                         });
//                     }
//                 } catch(err) {
//                     console.log(err);
//                     res.send({
//                         code: 0
//                     });
//                 }
//             })
//         } else {
//             res.send({
//                 code: 0
//             });
//         }
//     })
// });

// 로그인 데이터 처리
router.post('/login', async (req, res) => {
    const { id, pw } = req.body;

    try {
        // 데이터베이스에서 사용자 검색
        const user = await req.db.collection('login').findOne({ id });
        
        if (!user) {
            // 사용자 찾을 수 없음
            return res.redirect('/member/login?error=' +  encodeURIComponent('없는 아이디 입니다.')); // 아이디 오류시 문구 출력
        }

        // 암호 대조
        const isMatch = await bcrypt.compare(pw, user.pw);
        
        if (!isMatch) {
            // 비밀번호 불일치
            return res.redirect('/member/login?error=' + encodeURIComponent('비밀번호가 잘못되었습니다.')); // 비밀번호 오류시 문구 출력
        }

        // 로그인 성공 시 세션에 사용자 정보 저장
        req.session.user = { id: user.id };

        // 로그인 성공 - main 페이지로 다이렉션
        res.redirect('/main');
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).send({ message: 'Server error' });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).send('Error logging out.');
        }
        res.redirect('/main');
    });
});



// 회원가입 페이지 렌더링
router.get('/register', (req, res) => {
    res.render('register.ejs');
});

// 회원가입 데이터 처리
router.post('/register', async (req, res) => {
    console.log('in register post');
    
    const { name, phone, birthdate, email, id, pw } = req.body;

    // 모든 필드가 유효한지 확인
    if (!name || !phone || !birthdate || !email || !id || !pw) {
        return res.status(400).send({ message: 'All fields are required' });
    }

    try {
        // 비밀번호 암호화
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(pw, salt);

        // 데이터베이스에 새로운 유저 삽입
        const result = await req.db.collection('login').insertOne({
            name,
            phone,
            birthdate,
            email,
            id,
            pw: hashedPassword // 암호화된 비밀번호 저장
        });

        console.log('User registered:', result.insertedId);
        console.log('회원가입을 축하드립니다');
        res.status(200).send({ message: 'User registered successfully' }); // 상태 코드 200과 함께 응답
    } catch (error) {
        console.error('Database Insert Error:', error);
        res.status(500).send({ message: 'Database Insert Error' });
    }
});

module.exports = router;
