# Product specification

> Status: CURRENT_ARCHITECTURE
> Authority: This document describes the current product boundary; typed production contracts and source remain canonical, and this Markdown is not runtime configuration.

## Current product boundary

> State: CURRENT

AI Website Factory is a local application for one user. It will eventually orchestrate AI agents that create complete professional websites and moderately complex web applications as standalone versioned projects. This repository currently contains the Factory foundation plus implemented workflow, reviewer, execution, validation, and evidence infrastructure; complete customer-project generation remains planned.

## Planned MVP

> State: PLANNED_FUTURE

The future workflow collects a prompt, resolves unknowns, obtains brief approval and design selection, plans and implements the project, validates it, and writes a complete local project. The generated project is the product; it is not embedded in the Factory.

## Current decisions and exclusions

> State: CURRENT

There is one server-only AI provider using the GPT-5.6 Luna model label, and agents receive only relevant context. Business facts may not be invented, and approved requirements may not change without the user. The Factory is not SaaS, has no billing, deployment, multi-user infrastructure, or accessibility-audit requirement. Functional browser testing of generated customer projects remains planned; the Factory's controlled Playwright QA foundation is current.

## Deferred and excluded customer capabilities

> State: DEFERRED_WORK

No customer-site Preview, iframe, wildcard localhost routing, reverse proxy, screenshot-based visual review, Deployment Agent, CMS, microservices, separate worker, Redis/BullMQ, Kubernetes, or customer-site containers are part of the current foundation.
