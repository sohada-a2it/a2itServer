const Holiday = require('../models/HolidayModel');

// GET all holidays
exports.getHolidays = async (req, res) => {
  try {
    const holidays = await Holiday.find({}).sort({ date: 1 });
    res.status(200).json({ status: 'success', holidays });
  } catch (error) {
    res.status(500).json({ status: 'fail', message: error.message });
  }
};

// POST new holiday  

exports.addHoliday = async (req, res) => {
  try {
    // ধরে নিচ্ছি req.user.role থেকে role পাওয়া যায়
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ status: 'fail', message: 'Only admin can create holidays' });
    }

    const { title, date, type } = req.body;

    // validation
    if (!title || !date) {
      return res.status(400).json({ status: 'fail', message: 'Title and Date are required' });
    }

    // ensure type is valid enum
    const validTypes = ['GOVT', 'COMPANY'];
    if (type && !validTypes.includes(type)) {
      return res.status(400).json({ status: 'fail', message: 'Type must be GOVT or COMPANY' });
    }

    const holiday = await Holiday.create({
      title,
      date: new Date(date),
      type: type || 'GOVT',  // default GOVT
      source: 'ADMIN',        // since admin created
      isActive: true,
      year: new Date(date).getFullYear(),
      createdBy: req.user._id
    });

    res.status(201).json({ status: 'success', holiday });
  } catch (error) {
    res.status(500).json({ status: 'fail', message: error.message });
  }
};



// PATCH holiday
exports.updateHoliday = async (req, res) => {
  try {
    const holiday = await Holiday.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!holiday) return res.status(404).json({ status: 'fail', message: 'Holiday not found' });
    res.status(200).json({ status: 'success', holiday });
  } catch (error) {
    res.status(500).json({ status: 'fail', message: error.message });
  }
};

// DELETE holiday
exports.deleteHoliday = async (req, res) => {
  try {
    const holiday = await Holiday.findByIdAndDelete(req.params.id);
    if (!holiday) return res.status(404).json({ status: 'fail', message: 'Holiday not found' });
    res.status(200).json({ status: 'success', message: 'Holiday deleted' });
  } catch (error) {
    res.status(500).json({ status: 'fail', message: error.message });
  }
};
