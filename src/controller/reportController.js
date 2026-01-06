// controllers/reportController.js
const User = require('../models/UsersModel');
const Attendance = require('../models/AttendanceModel');
const Payroll = require('../models/PayrollModel');
const Leave = require('../models/LeaveModel');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Get employees for report dropdown
exports.getEmployeesForReport = async (req, res) => {
  try {
    const employees = await User.find({ 
      status: 'active',
      role: { $ne: 'admin' } // Exclude admins
    })
    .select('_id firstName lastName email employeeId department designation')
    .sort({ firstName: 1 });

    res.status(200).json({
      success: true,
      data: employees
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Get departments for report dropdown
exports.getDepartmentsForReport = async (req, res) => {
  try {
    const departments = await User.distinct('department', {
      department: { $ne: null, $ne: '' }
    });

    res.status(200).json({
      success: true,
      data: departments.sort()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Export Attendance Report
exports.exportAttendanceReport = async (req, res) => {
  try {
    const { format = 'excel', startDate, endDate, department, employeeId } = req.body;
    
    // Build query
    const query = {};
    
    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }
    
    if (department) {
      // Find employees in this department
      const employees = await User.find({ department }).select('_id');
      const employeeIds = employees.map(emp => emp._id);
      query.employee = { $in: employeeIds };
    }
    
    if (employeeId) {
      query.employee = mongoose.Types.ObjectId(employeeId);
    }

    // Fetch attendance data with employee details
    const attendanceRecords = await Attendance.find(query)
      .populate('employee', 'firstName lastName employeeId department designation')
      .sort({ date: -1, employee: 1 });

    if (format === 'excel') {
      await exportAttendanceExcel(attendanceRecords, res);
    } else if (format === 'pdf') {
      await exportAttendancePDF(attendanceRecords, res);
    } else {
      res.status(200).json({
        success: true,
        data: attendanceRecords,
        count: attendanceRecords.length
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Export Payroll Report
exports.exportPayrollReport = async (req, res) => {
  try {
    const { format = 'excel', month, year, department, status } = req.body;
    
    // Build query
    const query = {};
    
    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      query.periodStart = { $gte: startDate };
      query.periodEnd = { $lte: endDate };
    }
    
    if (department) {
      const employees = await User.find({ department }).select('_id');
      const employeeIds = employees.map(emp => emp._id);
      query.employee = { $in: employeeIds };
    }
    
    if (status) {
      query.status = status;
    }

    // Fetch payroll data
    const payrollRecords = await Payroll.find(query)
      .populate('employee', 'firstName lastName employeeId department designation')
      .sort({ periodStart: -1 });

    if (format === 'excel') {
      await exportPayrollExcel(payrollRecords, res);
    } else if (format === 'pdf') {
      await exportPayrollPDF(payrollRecords, res);
    } else {
      res.status(200).json({
        success: true,
        data: payrollRecords,
        count: payrollRecords.length
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Export Employee Summary Report
exports.exportEmployeeSummaryReport = async (req, res) => {
  try {
    const { format = 'excel', employeeId, startDate, endDate } = req.body;
    
    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: 'Employee ID is required'
      });
    }

    const employee = await User.findById(employeeId)
      .select('firstName lastName employeeId department designation email phone salary')
      .lean();

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    // Build date range
    const dateQuery = {};
    if (startDate && endDate) {
      dateQuery.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Get attendance summary
    const attendanceRecords = await Attendance.find({
      employee: employeeId,
      ...dateQuery
    });

    // Calculate attendance stats
    const stats = attendanceRecords.reduce((acc, record) => {
      if (['Present', 'Late', 'Clocked In'].includes(record.status)) {
        acc.present++;
        acc.totalHours += record.totalHours || 0;
      } else if (record.status === 'Absent') {
        acc.absent++;
      } else if (record.status === 'Leave') {
        acc.leave++;
      } else if (record.status === 'Late') {
        acc.late++;
      }
      return acc;
    }, { present: 0, absent: 0, leave: 0, late: 0, totalHours: 0 });

    // Get payroll summary
    const payrollRecords = await Payroll.find({
      employee: employeeId,
      ...(startDate && endDate ? {
        periodStart: { $gte: new Date(startDate) },
        periodEnd: { $lte: new Date(endDate) }
      } : {})
    })
    .sort({ periodStart: -1 });

    // Get leave history
    const leaveRecords = await Leave.find({
      employee: employeeId,
      status: 'Approved',
      ...(startDate && endDate ? {
        startDate: { $lte: new Date(endDate) },
        endDate: { $gte: new Date(startDate) }
      } : {})
    })
    .sort({ startDate: -1 });

    const reportData = {
      employee,
      attendance: {
        summary: stats,
        records: attendanceRecords.slice(0, 100) // Last 100 records
      },
      payroll: {
        summary: {
          totalRecords: payrollRecords.length,
          totalAmount: payrollRecords.reduce((sum, p) => sum + (p.netPayable || 0), 0),
          averagePay: payrollRecords.length > 0 
            ? payrollRecords.reduce((sum, p) => sum + (p.netPayable || 0), 0) / payrollRecords.length 
            : 0
        },
        records: payrollRecords.slice(0, 12) // Last 12 months
      },
      leave: {
        totalRecords: leaveRecords.length,
        totalDays: leaveRecords.reduce((sum, l) => {
          const diffTime = Math.abs(new Date(l.endDate) - new Date(l.startDate));
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
          return sum + diffDays;
        }, 0),
        records: leaveRecords.slice(0, 10) // Last 10 leaves
      }
    };

    if (format === 'excel') {
      await exportEmployeeExcel(reportData, res);
    } else if (format === 'pdf') {
      await exportEmployeePDF(reportData, res);
    } else {
      res.status(200).json({
        success: true,
        data: reportData
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// Helper functions for Excel export
const exportAttendanceExcel = async (records, res) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Attendance Report');
  
  // Add headers
  worksheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Employee ID', key: 'employeeId', width: 15 },
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Clock In', key: 'clockIn', width: 15 },
    { header: 'Clock Out', key: 'clockOut', width: 15 },
    { header: 'Total Hours', key: 'totalHours', width: 12 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Location', key: 'location', width: 20 }
  ];
  
  // Add rows
  records.forEach(record => {
    worksheet.addRow({
      date: record.date.toISOString().split('T')[0],
      employeeId: record.employee?.employeeId || 'N/A',
      name: `${record.employee?.firstName || ''} ${record.employee?.lastName || ''}`,
      department: record.employee?.department || 'N/A',
      clockIn: record.clockIn ? new Date(record.clockIn).toLocaleTimeString() : 'N/A',
      clockOut: record.clockOut ? new Date(record.clockOut).toLocaleTimeString() : 'N/A',
      totalHours: record.totalHours ? record.totalHours.toFixed(2) : '0.00',
      status: record.status,
      location: record.location || 'Office'
    });
  });
  
  // Set response headers
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=attendance_report.xlsx');
  
  // Send file
  await workbook.xlsx.write(res);
  res.end();
};

const exportPayrollExcel = async (records, res) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Payroll Report');
  
  // Add headers
  worksheet.columns = [
    { header: 'Pay Period', key: 'period', width: 25 },
    { header: 'Employee ID', key: 'employeeId', width: 15 },
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Basic Pay', key: 'basicPay', width: 15 },
    { header: 'Present Days', key: 'presentDays', width: 15 },
    { header: 'Leave Days', key: 'leaveDays', width: 15 },
    { header: 'Total Addition', key: 'totalAddition', width: 15 },
    { header: 'Total Deduction', key: 'totalDeduction', width: 15 },
    { header: 'Net Payable', key: 'netPayable', width: 15 },
    { header: 'Status', key: 'status', width: 15 }
  ];
  
  // Add rows
  records.forEach(record => {
    const periodStart = new Date(record.periodStart).toLocaleDateString();
    const periodEnd = new Date(record.periodEnd).toLocaleDateString();
    
    worksheet.addRow({
      period: `${periodStart} - ${periodEnd}`,
      employeeId: record.employee?.employeeId || 'N/A',
      name: `${record.employee?.firstName || ''} ${record.employee?.lastName || ''}`,
      department: record.employee?.department || 'N/A',
      basicPay: record.basicPay,
      presentDays: record.presentDays || 0,
      leaveDays: record.leaveDays || 0,
      totalAddition: record.totalAddition || 0,
      totalDeduction: record.totalDeduction || 0,
      netPayable: record.netPayable || 0,
      status: record.status
    });
  });
  
  // Set response headers
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=payroll_report.xlsx');
  
  // Send file
  await workbook.xlsx.write(res);
  res.end();
};

const exportEmployeeExcel = async (data, res) => {
  const workbook = new ExcelJS.Workbook();
  
  // Employee Info Sheet
  const infoSheet = workbook.addWorksheet('Employee Information');
  infoSheet.columns = [
    { header: 'Field', key: 'field', width: 25 },
    { header: 'Value', key: 'value', width: 40 }
  ];
  
  infoSheet.addRows([
    { field: 'Employee ID', value: data.employee.employeeId },
    { field: 'Full Name', value: `${data.employee.firstName} ${data.employee.lastName}` },
    { field: 'Department', value: data.employee.department },
    { field: 'Designation', value: data.employee.designation },
    { field: 'Email', value: data.employee.email },
    { field: 'Phone', value: data.employee.phone || 'N/A' },
    { field: 'Monthly Salary', value: data.employee.salary || 'N/A' }
  ]);
  
  // Attendance Sheet
  const attendanceSheet = workbook.addWorksheet('Attendance Summary');
  attendanceSheet.columns = [
    { header: 'Date', key: 'date', width: 15 },
    { header: 'Clock In', key: 'clockIn', width: 15 },
    { header: 'Clock Out', key: 'clockOut', width: 15 },
    { header: 'Total Hours', key: 'totalHours', width: 15 },
    { header: 'Status', key: 'status', width: 15 }
  ];
  
  data.attendance.records.forEach(record => {
    attendanceSheet.addRow({
      date: record.date.toISOString().split('T')[0],
      clockIn: record.clockIn ? new Date(record.clockIn).toLocaleTimeString() : 'N/A',
      clockOut: record.clockOut ? new Date(record.clockOut).toLocaleTimeString() : 'N/A',
      totalHours: record.totalHours ? record.totalHours.toFixed(2) : '0.00',
      status: record.status
    });
  });
  
  // Summary Sheet
  const summarySheet = workbook.addWorksheet('Summary');
  summarySheet.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 20 }
  ];
  
  summarySheet.addRows([
    { metric: 'Total Present Days', value: data.attendance.summary.present },
    { metric: 'Total Absent Days', value: data.attendance.summary.absent },
    { metric: 'Total Leave Days', value: data.attendance.summary.leave },
    { metric: 'Late Arrivals', value: data.attendance.summary.late },
    { metric: 'Total Working Hours', value: data.attendance.summary.totalHours.toFixed(2) },
    { metric: 'Average Daily Hours', value: (data.attendance.summary.present > 0 
      ? (data.attendance.summary.totalHours / data.attendance.summary.present).toFixed(2) 
      : '0.00') },
    { metric: 'Total Payroll Records', value: data.payroll.summary.totalRecords },
    { metric: 'Total Paid Amount', value: data.payroll.summary.totalAmount.toFixed(2) },
    { metric: 'Average Monthly Pay', value: data.payroll.summary.averagePay.toFixed(2) },
    { metric: 'Total Leave Applications', value: data.leave.totalRecords },
    { metric: 'Total Leave Days', value: data.leave.totalDays }
  ]);
  
  // Set response headers
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=employee_${data.employee.employeeId}_summary.xlsx`);
  
  // Send file
  await workbook.xlsx.write(res);
  res.end();
};

// Helper functions for PDF export (simplified version)
const exportAttendancePDF = async (records, res) => {
  const doc = new PDFDocument({ margin: 50 });
  
  // Set response headers
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=attendance_report.pdf');
  
  doc.pipe(res);
  
  // Add title
  doc.fontSize(20).text('Attendance Report', { align: 'center' });
  doc.moveDown();
  
  // Add date range
  doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
  doc.moveDown(2);
  
  // Add table headers
  const tableTop = doc.y;
  const headers = ['Date', 'Employee', 'Clock In', 'Clock Out', 'Hours', 'Status'];
  const colWidth = (doc.page.width - 100) / headers.length;
  
  headers.forEach((header, i) => {
    doc.fontSize(10)
       .text(header, 50 + (i * colWidth), tableTop, { width: colWidth, align: 'center' });
  });
  
  doc.moveDown();
  
  // Add rows
  records.slice(0, 50).forEach((record, index) => { // Limit to 50 rows for PDF
    const rowY = doc.y;
    
    doc.fontSize(8)
       .text(record.date.toISOString().split('T')[0], 50, rowY, { width: colWidth })
       .text(`${record.employee?.firstName || ''} ${record.employee?.lastName || ''}`, 
             50 + colWidth, rowY, { width: colWidth })
       .text(record.clockIn ? new Date(record.clockIn).toLocaleTimeString() : 'N/A', 
             50 + (colWidth * 2), rowY, { width: colWidth })
       .text(record.clockOut ? new Date(record.clockOut).toLocaleTimeString() : 'N/A', 
             50 + (colWidth * 3), rowY, { width: colWidth })
       .text(record.totalHours ? record.totalHours.toFixed(2) : '0.00', 
             50 + (colWidth * 4), rowY, { width: colWidth })
       .text(record.status, 50 + (colWidth * 5), rowY, { width: colWidth });
    
    doc.moveDown();
  });
  
  // Add summary
  doc.moveDown(2)
     .fontSize(10)
     .text(`Total Records: ${records.length}`, { align: 'right' });
  
  doc.end();
};