import { Router } from "express";
import { authToken, authRole } from "../middlewares/authMiddleware.js";
import { selectOrganization, validateBodyFields, validateParamExist, validateRequestBodyBinIds } from "../middlewares/validationMiddleware.js";
import { deleteBin, getAllUserBins, getBin, getBinsInUserRadius, getMapBins, getMapExtent, deleteBinsBatch, updateBinMaintenance, removeBinConfigViaMAC, updateBinName } from "../db/controllers/binController.js";
import { cancelDeviceInstruction, enqueueDeviceInstruction, listDeviceInstructions } from "../db/controllers/deviceInstructionController.js";
import { createOrganizationJoinCode, getMeshSettings, updateMeshSettings } from "../db/controllers/organizationController.js";
import { getBinAnalytics } from "../db/controllers/analyticsController.js";
import { ROLES } from "../utils/constants.js";

export const binRouter = Router();

//protected routes for admin panel requests 
binRouter.use(authToken) //demends jwt for all requests

//getters
binRouter.get('/all', getAllUserBins) //all user bins in db
binRouter.get('/map', getMapBins) //the devices in a map view (?south&west&north&east), marker fields only
binRouter.get('/map/extent', selectOrganization, getMapExtent) //the box around all the user's devices (an owner's ?org= narrows it)
// Organization settings: owners read every organization's, anyone else their
// own (a driver needs its trucks and depot); only owners and admins change
// them (checked in the controller).
binRouter.get('/mesh-settings', getMeshSettings)
binRouter.patch('/mesh-settings/:orgId', (req, res, next) => {
    authRole([ROLES.OWNER, ROLES.ADMIN])(req, res, next)
}, updateMeshSettings)
binRouter.post('/mesh-settings/:orgId/join-code', (req, res, next) => {
    authRole([ROLES.OWNER, ROLES.ADMIN])(req, res, next)
}, createOrganizationJoinCode) //a one-time code for the leaf being added
binRouter.get('/:id', validateParamExist(), getBin) //get bin
binRouter.get('/:id/analytics/:section', getBinAnalytics) //one bin page analytics section (?range=7|30|90)
binRouter.post('/radius', selectOrganization, validateBodyFields(['coordinates', 'radius'], ['health', 'minLevel', 'maxLevel', 'excludeReserved']), getBinsInUserRadius) //get bins
//updates
binRouter.patch('/maintenance/:id', (req, res, next) => {
    authRole([ROLES.OWNER, ROLES.ADMIN, ROLES.TECHNICIAN])(req, res, next) //update bin maintenance by id
}, validateParamExist(), validateBodyFields(['notes']), updateBinMaintenance)
binRouter.patch('/name/:id', (req, res, next) => {
    authRole([ROLES.OWNER, ROLES.ADMIN])(req, res, next) //update bin name by id
}, validateParamExist(), validateBodyFields(['name']), updateBinName)

// Device instructions: owners for any bin, admins for their organization's bins (checked in the controller).
binRouter.post('/:id/instructions', (req, res, next) => {
    authRole([ROLES.OWNER, ROLES.ADMIN])(req, res, next)
}, enqueueDeviceInstruction)
binRouter.get('/:id/instructions', (req, res, next) => {
    authRole([ROLES.OWNER, ROLES.ADMIN])(req, res, next)
}, listDeviceInstructions)
binRouter.delete('/:id/instructions/:instructionId', (req, res, next) => {
    authRole([ROLES.OWNER, ROLES.ADMIN])(req, res, next)
}, cancelDeviceInstruction)


//deletes
binRouter.delete('/', (req, res, next) => {
    authRole([ROLES.OWNER, ROLES.ADMIN])(req, res, next)
}, validateRequestBodyBinIds, deleteBinsBatch) //delete bins batch by id
binRouter.delete('/:id', (req, res, next) => {
    authRole([ROLES.OWNER, ROLES.ADMIN])(req, res, next)
}, validateParamExist(), deleteBin) //delete bin by id
//delete bin by mac and remove config
binRouter.delete('/mac/:macId', (req, res, next) => {
    authRole([ROLES.OWNER])(req, res, next)
}, validateParamExist('macId', false), removeBinConfigViaMAC)


