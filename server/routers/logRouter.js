
import { Router } from "express";
import { authRole, authToken } from "../middlewares/authMiddleware.js";
import { selectOrganization, validateParamExist } from "../middlewares/validationMiddleware.js";
import { getAllLogs, getBinLog } from '../db/controllers/binLogController.js'
export const logRouter = Router();
logRouter.use(authToken) //only admin can access log routes

logRouter.get('/', selectOrganization, getAllLogs) //get all logs data (an owner's ?org= narrows it)
logRouter.get('/:logId', validateParamExist('logId'), getBinLog) //get specific bin log id




