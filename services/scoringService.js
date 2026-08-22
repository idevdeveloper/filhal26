const Result = require('../models/Result');

async function calculateTeamScores() {
    try {
        // Aggregate points for Hermos and Gibraltar from published results
        const teamStats = await Result.aggregate([
            { $match: { status: 'published' } },
            {
                $group: {
                    _id: '$team',
                    totalPoints: { $sum: '$score' },
                    // You can break down by section/type if your program lookup supports it, 
                    // or aggregate basic categories
                }
            }
        ]);

        const scores = {
            Hermos: { total: 0, mainStage: 0, offStage: 0, individual: 0, group: 0, general: 0, teamProg: 0 },
            Gibraltar: { total: 0, mainStage: 0, offStage: 0, individual: 0, group: 0, general: 0, teamProg: 0 }
        };

        teamStats.forEach(stat => {
            if (scores[stat._id]) {
                scores[stat._id].total = stat.totalPoints;
            }
        });

        // Determine Champion
        let champion = "DRAW";
        if (scores.Hermos.total > scores.Gibraltar.total) {
            champion = "Hermos";
        } else if (scores.Gibraltar.total > scores.Hermos.total) {
            champion = "Gibraltar";
        }

        return { scores, champion };
    } catch (err) {
        console.error("Error calculating team scores:", err);
        return {
            scores: { Hermos: { total: 0 }, Gibraltar: { total: 0 } },
            champion: "DRAW"
        };
    }
}

module.exports = { calculateTeamScores };