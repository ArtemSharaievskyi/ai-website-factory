# Product specification

## Current foundation

AI Website Factory is a local application for one user. It will eventually orchestrate AI agents that create complete professional websites and moderately complex web applications as standalone versioned projects. This repository currently contains only the foundation application and documentation.

## Planned MVP

The future workflow collects a prompt, resolves unknowns, obtains brief approval and design selection, plans and implements the project, validates it, and writes a complete local project. The generated project is the product; it is not embedded in the Factory.

## Fixed decisions and exclusions

There is one AI provider, with GPT-5.6 Luna intended, and agents receive only relevant context. Business facts may not be invented, and approved requirements may not change without the user. The Factory is not SaaS, has no billing, deployment, multi-user infrastructure, or accessibility-audit requirement. Functional browser testing is planned later.

No customer-site Preview, iframe, wildcard localhost routing, reverse proxy, screenshot-based visual review, Deployment Agent, CMS, microservices, separate worker, Redis/BullMQ, Kubernetes, or customer-site containers are part of this foundation.
