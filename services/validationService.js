const User = require('../models/User');

async function validateResultEntry(programId, chessNumbersInput) {
    let chessArray = [];
    if (typeof chessNumbersInput === 'string') {
        chessArray = chessNumbersInput.split(',').map(c => c.trim()).filter(c => c);
    } else if (Array.isArray(chessNumbersInput)) {
        chessArray = chessNumbersInput;
    }

    if (chessArray.length === 0) {
        throw new Error("At least one valid chest number must be provided.");
    }

    const users = await User.find({ chessNumber: { $in: chessArray }, role: 'PARTICIPANT' });

    if (users.length !== chessArray.length) {
        const foundNumbers = users.map(u => u.chessNumber);
        const missing = chessArray.filter(c => !foundNumbers.includes(c));
        throw new Error(`Participant(s) with chest number(s) not found: ${missing.join(', ')}`);
    }

    const team = users[0].team;
    const mixedTeam = users.some(u => u.team !== team);
    if (mixedTeam) {
        throw new Error("All participants in a single placement entry must belong to the same team.");
    }

    return { users, team };
}

module.exports = { validateResultEntry };