const mongoose = require('mongoose');

const resultSchema = new mongoose.Schema({
    program: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Program',
        required: true
    },
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    team: {
        type: String,
        required: true
    },
    score: {
        type: Number,
        required: true,
        min: 0
        // Removed max restriction completely so 20, 15, or any custom point value is fully allowed
    },
    position: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft'
    },
    judgedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, { timestamps: true });

module.exports = mongoose.model('Result', resultSchema);