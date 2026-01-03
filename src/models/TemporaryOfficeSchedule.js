const mongoose = require("mongoose");

const officeScheduleOverrideSchema = new mongoose.Schema({
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },

  weeklyOffDays: {
    type: [String],
    enum: [
      "Sunday","Monday","Tuesday","Wednesday",
      "Thursday","Friday","Saturday"
    ],
    required: true
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },

  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model(
  "OfficeScheduleOverride",
  officeScheduleOverrideSchema
);
