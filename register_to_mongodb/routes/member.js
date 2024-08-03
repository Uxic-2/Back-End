const router = require('express').Router();

router.get('/login', (req, res) => {
    res.render('login.ejs');
});

router.get('/register', (req, res) => {
    res.render('register.ejs');
});

router.post('/register', (req, res) => {
    console.log('in register post');

    let id = req.body.id;
    let pw = req.body.pw;

    db.collection('login').insertOne({ id: id, pw: pw }, (error, result) => {
        if (error) {
            return res.status(500).send({ message: 'Database Insert Error' });
        }
        res.status(200).send({ message: 'ajax 통신 성공 - id: ' + id + ', pw: ' + pw });
    });
});

module.exports = router;
