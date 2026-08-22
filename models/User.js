const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    role: { type: String, enum: ['ADMIN', 'JUDGE', 'PARTICIPANT'], required: true },
    name: { type: String, required: true },
    chessNumber: { type: String, unique: true, sparse: true },
    category: { type: String, enum: ['Sub Junior', 'Junior', 'Senior'] }, // No General/Team
    gender: { type: String, enum: ['Boys', 'Girls'] },
    team: { type: String, enum: ['Hermos', 'Gibraltar'] },
    password: { type: String, required: true }
}, { timestamps: true });

userSchema.pre('save', async function() {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
});

module.exports = mongoose.model('User', userSchema);