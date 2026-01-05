// utils/sessionActivity.js
const SessionLog = require('../models/SessionLogModel');

const addSessionActivity = async ({ userId, action, target = null, details = {} }) => {
  try {
    let session = await SessionLog.findOne({ userId, logoutAt: null }).sort({ loginAt: -1 });

    if (!session) {
      session = await SessionLog.create({
        userId,
        loginAt: new Date(),
        ip: details.ip || 'N/A',
        device: details.device || 'N/A',
        activities: []
      });
    }

    session.activities.push({
      action,
      target,
      details,
      timestamp: new Date()
    });

    await session.save();
    return session;
  } catch (error) {
    console.error('Add session activity failed:', error);
    return null;
  }
};

module.exports = addSessionActivity;