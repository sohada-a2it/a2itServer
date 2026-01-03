const mongoose = require("mongoose");

const officeScheduleSchema = new mongoose.Schema(
  {
    weeklyOffDays: {
      type: [String],
      enum: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      default: ["Friday", "Saturday"] // govt default
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OfficeSchedule", officeScheduleSchema);
