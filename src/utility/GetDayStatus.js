const Holiday = require("../models/HolidayModel");
const OfficeSchedule = require("../models/OfficeScheduleModel");
const OfficeScheduleOverride = require("../models/OfficeScheduleOverrideModel");

exports.getDayStatus = async (date) => {
  const dayName = new Date(date).toLocaleString("en-US", {
    weekday: "long",
  });

  // 1️⃣ Govt / Company Holiday
  const holiday = await Holiday.findOne({
    date: new Date(date),
    isActive: true
  });

  if (holiday) {
    return "HOLIDAY";
  }

  // 2️⃣ Temporary Weekly Override
  const override = await OfficeScheduleOverride.findOne({
    isActive: true,
    startDate: { $lte: date },
    endDate: { $gte: date }
  });

  if (override && override.weeklyOffDays.includes(dayName)) {
    return "WEEKLY_OFF";
  }

  // 3️⃣ Default Office Schedule
  const schedule = await OfficeSchedule.findOne({ isActive: true });

  const weeklyOffDays = schedule?.weeklyOffDays || ["Friday", "Saturday"];

  if (weeklyOffDays.includes(dayName)) {
    return "WEEKLY_OFF";
  }

  // 4️⃣ Normal Working Day
  return "WORKING_DAY";
};
