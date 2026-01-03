const cron = require('node-cron');
const { autoSyncBangladeshHolidays, autoMarkHolidayAttendance } = require('../services/holidayService');

// ===================== 1️⃣ Yearly Sync =====================
// Run once at Jan 1st 00:05
cron.schedule('5 0 1 1 *', async () => {
  console.log('Running yearly Bangladesh holiday sync...');
  await autoSyncBangladeshHolidays();
});

// ===================== 2️⃣ Daily Auto Attendance =====================
// Run every day at 00:01 AM
cron.schedule('1 0 * * *', async () => {
  console.log('Running daily auto holiday attendance...');
  await autoMarkHolidayAttendance();
});
