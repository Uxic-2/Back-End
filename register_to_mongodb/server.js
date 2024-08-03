const express = require('express');
const app = express();
const MongoClient = require('mongodb').MongoClient;

app.use(express.urlencoded({ extended: true }));

const db_url = 'mongodb+srv://bhw119:YYLitUv8euBCtgxA@uxic.xsjkwl9.mongodb.net/?retryWrites=true&w=majority&appName=Uxic';

async function main() {
    try {
        const client = new MongoClient(db_url);
        await client.connect();
        db = client.db('db');
        console.log('Connected to database');

        app.listen(8080, () => {
            console.log('server on port 8080');
        });
    } catch (error) {
        console.error(error);
    }
}

main().catch(console.error);

app.set('view engine', 'ejs');

app.get('/', (req, res) => {
    res.render('index.ejs');
});

app.use('/member', require('./routes/member.js'));
