const OfficeSchedule = require("../models/OfficeScheduleModel");
const OfficeScheduleOverride = require("../models/TemporaryOfficeSchedule");

/**
 * Get Weekly Off (Auto fallback with override)
 */
exports.getWeeklyOff = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0,0,0,0);

    // Check for active override first
    const override = await OfficeScheduleOverride.findOne({
      startDate: { $lte: today },
      endDate: { $gte: today },
      isActive: true
    });

    if (override) {
      return res.status(200).json({
        status: "success",
        weeklyOffDays: override.weeklyOffDays,
        override: true
      });
    }

    // Fallback to default schedule
    let schedule = await OfficeSchedule.findOne({ isActive: true });

    if (!schedule) {
      schedule = await OfficeSchedule.create({
        weeklyOffDays: ["Friday", "Saturday"],
      });
    }

    res.status(200).json({
      status: "success",
      weeklyOffDays: schedule.weeklyOffDays,
      override: false
    });

  } catch (err) {
    res.status(500).json({ status: "fail", message: err.message });
  }
};

/**
 * Update Weekly Off (Admin only)
 */
exports.updateWeeklyOff = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ status: "fail", message: "Only admin allowed" });
    }

    const { weeklyOffDays } = req.body;
    if (!weeklyOffDays || !weeklyOffDays.length) {
      return res.status(400).json({ status: "fail", message: "weeklyOffDays required" });
    }

    let schedule = await OfficeSchedule.findOne({ isActive: true });

    if (!schedule) {
      schedule = await OfficeSchedule.create({
        weeklyOffDays,
        createdBy: req.user._id,
      });
    } else {
      schedule.weeklyOffDays = weeklyOffDays;
      schedule.createdBy = req.user._id;
      await schedule.save();
    }

    res.status(200).json({
      status: "success",
      message: "Weekly off updated",
      weeklyOffDays: schedule.weeklyOffDays
    });

  } catch (err) {
    res.status(500).json({ status: "fail", message: err.message });
  }
};

/**
 * Create Temporary Override (Admin only)
 */
exports.createOrUpdateOverride = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ status: "fail", message: "Only admin allowed" });
    }

    const { startDate, endDate, weeklyOffDays } = req.body;

    if (!startDate || !endDate || !weeklyOffDays || !weeklyOffDays.length) {
      return res
        .status(400)
        .json({ status: "fail", message: "startDate, endDate and weeklyOffDays required" });
    }

    // Check if override already exists for the period
    let override = await OfficeScheduleOverride.findOne({
      startDate: { $lte: new Date(endDate) },
      endDate: { $gte: new Date(startDate) },
      isActive: true
    });

    if (!override) {
      override = await OfficeScheduleOverride.create({
        startDate,
        endDate,
        weeklyOffDays,
        createdBy: req.user._id
      });
    } else {
      override.weeklyOffDays = weeklyOffDays;
      override.startDate = startDate;
      override.endDate = endDate;
      override.createdBy = req.user._id;
      await override.save();
    }

    res.status(200).json({
      status: "success",
      message: "Temporary weekly off override applied",
      override
    });
  } catch (err) {
    res.status(500).json({ status: "fail", message: err.message });
  }
};
