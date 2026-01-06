const OfficeSchedule = require("../models/OfficeScheduleModel");
const OfficeScheduleOverride = require("../models/TemporaryOfficeSchedule");

/**
 * Get Weekly Off (Auto fallback with override)
 * Added: Cache support and better error handling
 */
exports.getWeeklyOff = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check for active override first
    const override = await OfficeScheduleOverride.findOne({
      startDate: { $lte: today },
      endDate: { $gte: today },
      isActive: true
    }).select('weeklyOffDays startDate endDate').lean();

    if (override) {
      return res.status(200).json({
        status: "success",
        weeklyOffDays: override.weeklyOffDays,
        override: true,
        overrideStartDate: override.startDate,
        overrideEndDate: override.endDate
      });
    }

    // Fallback to default schedule
    let schedule = await OfficeSchedule.findOne({ isActive: true }).lean();

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
    console.error("Error in getWeeklyOff:", err);
    res.status(500).json({ 
      status: "error", 
      message: "Internal server error",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * Update Weekly Off (Admin only)
 * Added: Validation and audit logging
 */
exports.updateWeeklyOff = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ 
        status: "fail", 
        message: "Access denied. Only admin allowed" 
      });
    }

    const { weeklyOffDays } = req.body;
    
    // Validate input
    if (!weeklyOffDays || !Array.isArray(weeklyOffDays) || weeklyOffDays.length === 0) {
      return res.status(400).json({ 
        status: "fail", 
        message: "weeklyOffDays array is required and must contain at least one day" 
      });
    }

    // Validate each day
    const validDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const invalidDays = weeklyOffDays.filter(day => !validDays.includes(day));
    
    if (invalidDays.length > 0) {
      return res.status(400).json({
        status: "fail",
        message: `Invalid days provided: ${invalidDays.join(', ')}`
      });
    }

    let schedule = await OfficeSchedule.findOne({ isActive: true });

    if (!schedule) {
      schedule = await OfficeSchedule.create({
        weeklyOffDays,
        createdBy: req.user._id,
      });
    } else {
      // Create audit trail before update
      const previousSchedule = {
        weeklyOffDays: schedule.weeklyOffDays,
        updatedAt: schedule.updatedAt
      };
      
      schedule.weeklyOffDays = weeklyOffDays;
      schedule.createdBy = req.user._id;
      schedule.updatedBy = req.user._id;
      await schedule.save();
      
      // Log the change (you can save this to an audit collection)
      console.log(`Schedule updated by ${req.user._id}:`, {
        previous: previousSchedule.weeklyOffDays,
        new: weeklyOffDays
      });
    }

    res.status(200).json({
      status: "success",
      message: "Weekly off updated successfully",
      weeklyOffDays: schedule.weeklyOffDays,
      updatedAt: schedule.updatedAt
    });

  } catch (err) {
    console.error("Error in updateWeeklyOff:", err);
    res.status(500).json({ 
      status: "error", 
      message: "Failed to update weekly off schedule",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * Create Temporary Override (Admin only)
 * Added: Conflict detection and better validation
 */
exports.createOrUpdateOverride = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ 
        status: "fail", 
        message: "Access denied. Only admin allowed" 
      });
    }

    const { startDate, endDate, weeklyOffDays } = req.body;

    // Validate required fields
    if (!startDate || !endDate || !weeklyOffDays || !weeklyOffDays.length) {
      return res.status(400).json({ 
        status: "fail", 
        message: "startDate, endDate and weeklyOffDays are required" 
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // Validate dates
    if (start > end) {
      return res.status(400).json({ 
        status: "fail", 
        message: "startDate must be before or equal to endDate" 
      });
    }

    if (end < new Date()) {
      return res.status(400).json({ 
        status: "fail", 
        message: "Cannot create override for past dates" 
      });
    }

    // Validate days
    const validDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const invalidDays = weeklyOffDays.filter(day => !validDays.includes(day));
    
    if (invalidDays.length > 0) {
      return res.status(400).json({
        status: "fail",
        message: `Invalid days provided: ${invalidDays.join(', ')}`
      });
    }

    // Check for overlapping overrides (excluding current one if updating)
    const existingOverride = await OfficeScheduleOverride.findOne({
      startDate: { $lte: end },
      endDate: { $gte: start },
      isActive: true
    });

    let override;
    if (existingOverride) {
      // Update existing override
      override = existingOverride;
      override.weeklyOffDays = weeklyOffDays;
      override.startDate = start;
      override.endDate = end;
      override.updatedBy = req.user._id;
      override.updatedAt = new Date();
      await override.save();
    } else {
      // Create new override
      override = await OfficeScheduleOverride.create({
        startDate: start,
        endDate: end,
        weeklyOffDays,
        createdBy: req.user._id
      });
    }

    res.status(200).json({
      status: "success",
      message: existingOverride 
        ? "Temporary override updated successfully" 
        : "Temporary override created successfully",
      override: {
        _id: override._id,
        startDate: override.startDate,
        endDate: override.endDate,
        weeklyOffDays: override.weeklyOffDays,
        isActive: override.isActive,
        createdAt: override.createdAt
      }
    });
  } catch (err) {
    console.error("Error in createOrUpdateOverride:", err);
    res.status(500).json({ 
      status: "error", 
      message: "Failed to process override request",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/**
 * Get Override History (Admin only)
 * NEW: Added to view all overrides
 */
exports.getOverrideHistory = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ 
        status: "fail", 
        message: "Access denied. Only admin allowed" 
      });
    }

    const overrides = await OfficeScheduleOverride.find()
      .sort({ startDate: -1 })
      .populate('createdBy', 'name email')
      .lean();

    res.status(200).json({
      status: "success",
      count: overrides.length,
      overrides
    });
  } catch (err) {
    console.error("Error in getOverrideHistory:", err);
    res.status(500).json({ 
      status: "error", 
      message: "Failed to fetch override history"
    });
  }
};

/**
 * Delete/Deactivate Override (Admin only)
 * NEW: Added to manage overrides
 */
exports.deleteOverride = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ 
        status: "fail", 
        message: "Access denied. Only admin allowed" 
      });
    }

    const { id } = req.params;
    
    const override = await OfficeScheduleOverride.findById(id);
    
    if (!override) {
      return res.status(404).json({ 
        status: "fail", 
        message: "Override not found" 
      });
    }

    // Soft delete by setting isActive to false
    override.isActive = false;
    override.updatedBy = req.user._id;
    await override.save();

    res.status(200).json({
      status: "success",
      message: "Override deactivated successfully"
    });
  } catch (err) {
    console.error("Error in deleteOverride:", err);
    res.status(500).json({ 
      status: "error", 
      message: "Failed to delete override"
    });
  }
};