import { Router, type IRouter } from "express";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import healthRouter from "./health";
import inboxRouter from "./inbox";
import invoicesRouter from "./invoices";
import voiceRouter from "./voice";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// Public: health checks and login must work before a session exists.
router.use(healthRouter);
router.use(authRouter);
router.use(voiceRouter); // Twilio fetches this mid-call, so it can't require a login

// Everything else requires an authenticated admin session.
router.use(requireAuth);
router.use(dashboardRouter);
router.use(invoicesRouter);
router.use(inboxRouter);

export default router;
