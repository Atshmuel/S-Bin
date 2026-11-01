import mongoose from "mongoose";
import { userSchema } from '../schema/userSchema.js'
import { binLogSchema } from '../schema/binLogSchema.js'
import { binSchema } from '../schema/binSchema.js'
import { templateSchema } from "../schema/templatesSchema.js";
import { userSettingsSchema } from "../schema/userSettingsSchema.js"
import { organizationSchema } from "../schema/organizationSchema.js";
import { deviceInstructionSchema } from "../schema/deviceInstructionSchema.js";
import { routeSchema } from "../schema/routeSchema.js";
import { routeReservationSchema } from "../schema/routeReservationSchema.js";
import { orgStatSchema } from "../schema/orgStatSchema.js";
import { deviceDiagnosticSchema } from "../schema/deviceDiagnosticSchema.js";
import { joinCodeSchema } from "../schema/joinCodeSchema.js";
import { deletedLeafSchema } from "../schema/deletedLeafSchema.js";

export const binModel = mongoose.model("Bin", binSchema);
export const binLogModel = mongoose.model("BinLog", binLogSchema);
export const userModel = mongoose.model("User", userSchema);
export const organizationModel = mongoose.model("Organization", organizationSchema);
export const userSettingModel = mongoose.model("UserSettings", userSettingsSchema);
export const templateModel = mongoose.model("Template", templateSchema);
export const deviceInstructionModel = mongoose.model("DeviceInstruction", deviceInstructionSchema);
export const routeModel = mongoose.model("Route", routeSchema);
export const routeReservationModel = mongoose.model("RouteReservation", routeReservationSchema);
export const orgStatModel = mongoose.model("OrgStat", orgStatSchema);
export const deviceDiagnosticModel = mongoose.model("DeviceDiagnostic", deviceDiagnosticSchema);
export const joinCodeModel = mongoose.model("JoinCode", joinCodeSchema);
export const deletedLeafModel = mongoose.model("DeletedLeaf", deletedLeafSchema);
