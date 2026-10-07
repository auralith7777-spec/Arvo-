import { Router, type IRouter } from "express";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import healthRouter from "./health";
import invoicesRouter from "./invoices";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// Public: health checks and login must work before a session exists.
router.use(healthRouter);
router.use(authRouter);

// Everything else requires an authenticated admin session.
router.use(requireAuth);
router.use(dashboardRouter);
router.use(invoicesRouter);

export default router;
