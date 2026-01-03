const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema(
  {
    title: String,
    date: Date,
    type: { type: String, enum: ["GOVT", "COMPANY"], required: true },
    source: { type: String, enum: ["AUTO", "ADMIN"], default: "ADMIN" },
    year: Number,
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Holiday", holidaySchema);
