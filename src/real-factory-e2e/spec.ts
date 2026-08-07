export const VELOFIX_WERKSTATT_PROMPT = `Create a synthetic German bicycle repair workshop website for VeloFix Werkstatt.
Purpose: Present VeloFix Werkstatt as a bicycle repair service for local bicycle owners.
Language: German.
Pages: home, services, appointment.
Routes/titles: slash titled "Startseite", /leistungen titled "Leistungen", and /termin titled "Termin vereinbaren".
Content: The home page introduces VeloFix Werkstatt and bicycle repairs; the services page explains the bicycle repair service; the appointment page explains how to request an appointment and presents the appointment form. Placeholder copy may be generated from these supplied facts, but must not add unsupported business claims.
Submission behavior: After valid client and server validation, show a German success message; do not send an email and do not persist the submitted data.
Validation/runtime: Use client and server validation through the existing Next.js server boundary; hosting and deployment are outside this smoke scenario.
Implementation boundary: Use a Next.js Server Action for the appointment form; no Route Handler is required for this smoke scenario.
Validation rules: All four fields are required and the E-Mail field must use standard email-format validation; no additional length rules are required.
Design: No palette, typography, logo, or layout is prescribed; propose a neutral bicycle-oriented direction in the existing three-direction Design stage.
Design selection: Do not select a direction during intake; after Planner, the existing Design stage must present exactly three directions and the user then selects one.
Planning acceptance: Accept the complete planning package before entering the Design stage; the later three-direction selection is not a Planner blocker.
Workflow order: The Project Brief is finalized and explicitly approved before Planner runs; do not require Planning Acceptance, Design, or Design Selection as a Brief prerequisite.
Audience: Local bicycle owners.
Primary action: Request an appointment.
Appointment form fields: exactly Name (required), E-Mail (required), Fahrradtyp (required), and Beschreibung des Problems (required).
Logo: No supplied logo.
Images: Use placeholders for imagery.
Acceptance: Local navigation, an appointment form with client and server validation, and a successful production build.
Administration: No admin or management area is required; keep the site public and guest-facing.
Exclusions: Do not invent address, opening hours, prices, staff, testimonials, contact details, or customer data.`;
