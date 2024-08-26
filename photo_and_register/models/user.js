// User정보 저장하는 곳

const mongoose = require('mongoose')

const UserSchema = new mongoose.Schema({
    ID: {
        type: String,
        required: true,
    },
    PW: {
        type: String,
        required: true,
    },
});

module.exports = User = mongoose.model("user", UserSchema);