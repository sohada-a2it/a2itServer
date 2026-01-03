const SalaryRule = require('../models/SalaryRuleModel');

// ---------------- Create Salary Rule ----------------
exports.createSalaryRule = async (req, res) => {
  try {
    const { title, salaryType, rate, overtimeRate, bonus, leaveRule, lateRule } = req.body;

    const rule = await SalaryRule.create({
      title,
      salaryType,
      rate,
      overtimeRate,
      bonus,
      leaveRule,
      lateRule,
      createdBy: req.user._id
    });

    res.status(201).json({ status: 'success', rule });
  } catch (err) {
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

// ---------------- Get All Salary Rules ----------------
exports.getAllSalaryRules = async (req, res) => {
  try {
    const rules = await SalaryRule.find().populate('createdBy', 'name email');
    res.status(200).json({ status: 'success', rules });
  } catch (err) {
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

// ---------------- Update Salary Rule ----------------
exports.updateSalaryRule = async (req, res) => {
  try {
    const rule = await SalaryRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ status: 'fail', message: 'Rule not found' });

    const { title, salaryType, rate, overtimeRate, bonus, leaveRule, lateRule, isActive } = req.body;

    if (title) rule.title = title;
    if (salaryType) rule.salaryType = salaryType;
    if (rate !== undefined) rule.rate = rate;
    if (overtimeRate !== undefined) rule.overtimeRate = overtimeRate;
    if (bonus !== undefined) rule.bonus = bonus;
    if (leaveRule) rule.leaveRule = leaveRule;
    if (lateRule) rule.lateRule = lateRule;
    if (isActive !== undefined) rule.isActive = isActive;

    await rule.save();
    res.status(200).json({ status: 'success', rule });

  } catch (err) {
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

// ---------------- Delete Salary Rule ----------------
exports.deleteSalaryRule = async (req, res) => {
  try {
    const rule = await SalaryRule.findByIdAndDelete(req.params.id);
    if (!rule) return res.status(404).json({ status: 'fail', message: 'Rule not found' });

    res.status(200).json({ status: 'success', message: 'Rule deleted successfully' });
  } catch (err) {
    res.status(500).json({ status: 'fail', message: err.message });
  }
};
