# Jacky's Service Portal

Field-Service-First Service Management System for Jacky's Distribution.

Built with NestJS + PostgreSQL + JWT + React.

## Project Structure

```
jackys-service-portal/
├── src/
│   ├── auth/                 # Authentication & Authorization
│   │   ├── entities/         # User, Role, AuditLog
│   │   ├── strategies/       # JWT, Refresh strategies
│   │   ├── guards/           # JwtAuthGuard, RolesGuard
│   │   ├── decorators/       # @Roles, @Audit
│   │   ├── dto/              # Login, RefreshToken DTOs
│   │   ├── auth.service.ts
│   │   ├── auth.controller.ts
│   │   └── auth.module.ts
│   ├── master-data/          # Master Data Management
│   │   ├── entities/         # 9 master data entities
│   │   ├── master-data.service.ts
│   │   ├── master-data.controller.ts
│   │   └── master-data.module.ts
│   ├── appointments/         # Appointment Scheduling (to implement)
│   ├── technician/           # Technician Mobile API (to implement)
│   ├── job-cards/            # Job Card Management (to implement)
│   ├── estimates/            # Estimate Management (to implement)
│   ├── workshop/             # Workshop Operations (to implement)
│   ├── inventory/            # Inventory & Spare Parts (to implement)
│   ├── delivery/             # Delivery & Logistics (to implement)
│   ├── finance/              # Finance & Invoicing (to implement)
│   ├── amc/                  # AMC Management (to implement)
│   ├── dismantling/          # Dismantling Module (to implement)
│   ├── notifications/        # Notifications Service (to implement)
│   ├── reports/              # Reports & Dashboards (to implement)
│   ├── customer-portal/      # Customer Portal (to implement)
│   ├── common/               # Shared utilities
│   │   ├── decorators/       # @Audit
│   │   ├── interceptors/     # AuditInterceptor
│   │   ├── filters/          # Exception filters
│   │   ├── guards/           # Additional guards
│   │   ├── pipes/            # Validation pipes
│   │   ├── utils/            # Helper functions
│   │   ├── dto/              # Common DTOs
│   │   └── exceptions/       # Custom exceptions
│   ├── app.module.ts
│   └── main.ts
├── docs/
│   ├── brd/                  # BRD documents
│   ├── discovery/            # Discovery document
│   └── planning/             # Implementation plan
├── .env
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── nest-cli.json
```

## Quick Start

### 1. Start PostgreSQL Database

```bash
docker-compose up -d postgres
```

Or use pgAdmin at http://localhost:5050 (admin@jackys.com / admin)

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Copy `.env` and update values as needed:

```bash
cp .env .env.local
# Edit .env.local with your values
```

### 4. Run Database Migrations (TypeORM sync enabled in dev)

The application uses `synchronize: true` in development, so tables will be created automatically on first run.

### 5. Start Development Server

```bash
npm run start:dev
```

The API will be available at:
- **API**: http://localhost:3000/api/v1
- **Swagger Docs**: http://localhost:3000/api/docs

### 6. Seed System Roles

```bash
curl -X POST http://localhost:3000/api/v1/auth/seed-roles \
  -H "Authorization: Bearer <super-admin-token>"
```

Or call programmatically after creating a SUPER_ADMIN user.

## Key Features Implemented

### ✅ Auth Module
- JWT authentication (RS256) with access (15m) + refresh (7d) tokens
- Role-based access control (14 roles from BRD)
- Audit logging on all mutating operations
- Password hashing with bcrypt (12 rounds)
- Password change endpoint

### ✅ Master Data Module (9 Entities)
1. **ServiceCentre** - Schedules, capacity, VAT rates by country
2. **FaultSymptom** - Fault codes, symptoms, categories, workshop flags
3. **SparePart** - Parts with pricing (B2B/B2C), stock levels, model mappings
4. **SparePartModel** - Appliance models linked to spare parts
5. **ServicePriceList** - Pricing by activity type (Install/Repair/Demo/On-Site/PM/Dismantle)
6. **TechnicianKpiRule** - KPI definitions with weightage, targets, incentives
7. **NotificationTemplate** - Multi-channel (WhatsApp/Email/SMS) templates with placeholders
8. **WarrantyMaster** - Serial number range validation with supplier info
9. **ComponentYieldMatrix** - Dismantling BOM-to-spare conversion rules

### ✅ Common Infrastructure
- Global validation pipe (class-validator)
- Swagger/OpenAPI documentation
- Helmet + CORS security
- Audit interceptor for automatic logging
- Type-safe role decorators

## API Endpoints (Implemented)

### Auth
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/refresh` - Refresh tokens
- `POST /api/v1/auth/logout` - Logout
- `POST /api/v1/auth/change-password` - Change password
- `GET /api/v1/auth/profile` - Get profile
- `POST /api/v1/auth/seed-roles` - Seed roles (SUPER_ADMIN)

### Master Data
- `POST /api/v1/master-data/service-centres` - Create service centre
- `GET /api/v1/master-data/service-centres` - List service centres
- `GET /api/v1/master-data/service-centres/:id` - Get service centre
- `PUT /api/v1/master-data/service-centres/:id` - Update service centre
- `DELETE /api/v1/master-data/service-centres/:id` - Delete service centre

- `POST /api/v1/master-data/fault-symptoms` - Create fault/symptom
- `GET /api/v1/master-data/fault-symptoms` - List fault/symptoms
- `GET /api/v1/master-data/fault-symptoms/code/:faultCode` - Find by fault code
- `GET /api/v1/master-data/fault-symptoms/symptom/:symptomCode` - Find by symptom code

- `POST /api/v1/master-data/spare-parts` - Create spare part
- `GET /api/v1/master-data/spare-parts` - List spare parts
- `GET /api/v1/master-data/spare-parts/:id` - Get spare part
- `GET /api/v1/master-data/spare-parts/model/:modelId` - Parts by model

- `POST /api/v1/master-data/spare-part-models` - Create model
- `GET /api/v1/master-data/spare-part-models` - List models

- `POST /api/v1/master-data/price-lists` - Create price list
- `GET /api/v1/master-data/price-lists` - Get price list by activity type

- `POST /api/v1/master-data/kpi-rules` - Create KPI rule
- `GET /api/v1/master-data/kpi-rules` - List KPI rules

- `POST /api/v1/master-data/notification-templates` - Create template
- `GET /api/v1/master-data/notification-templates` - List templates
- `GET /api/v1/master-data/notification-templates/:trigger/:channel` - Get template

- `POST /api/v1/master-data/warranty-master` - Create warranty entry
- `GET /api/v1/master-data/warranty-master/check/:serialNumber` - Check warranty

- `POST /api/v1/master-data/component-yield` - Create yield entry
- `GET /api/v1/master-data/component-yield/model/:modelId` - Yield by model
- `GET /api/v1/master-data/component-yield/category/:category` - Yield by category

- `POST /api/v1/master-data/bulk-import/:entityType` - Bulk import from CSV/Excel

## User Roles (from BRD)

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| SUPER_ADMIN | Full system access | All |
| SERVICE_HEAD | Service department head | Manage all, AMC, dismantling |
| TECHNICAL_TEAM_LEADER | Team leader | Spare validation, warranty override, job assignment, QC |
| CCE | Customer Care Executive | Appointments, job cards, estimates, invoices, customers |
| TECHNICIAN_FIELD | Field Technician | View jobs, update status, request spares, complete repair, POD |
| TECHNICIAN_WORKSHOP | Workshop Technician | View jobs, update status, log spares, complete repair, QC |
| QC_OFFICER | QC Officer | Manage QC, view workshop jobs |
| ACCOUNTANT | Finance Accountant | Invoices, payments, GL |
| FINANCE_MANAGER | Finance Manager | All finance, interdept, vendor claims |
| LOGISTICS_DISPATCHER | Logistics Dispatcher | Delivery, batch, ready jobs |
| DRIVER | Delivery Driver | View deliveries, capture POD |
| WAREHOUSE_CLERK | Warehouse Clerk | GRN, van stock, inventory |
| WARRANTY_CLERK | Warranty Clerk | Warranty claims |
| CUSTOMER | End Customer | Track jobs, approve estimates, pay invoices |

## Business Rules (Key)

From BRD Rev 2.1:
- **Field-Service-First**: Technician visits on-site FIRST, validates S/N + warranty
- **Inventory**: Spares RESERVED during WIP; deducted ONLY at QC Passed (auto Main Store → Damage Location)
- **S/N Validation**: Mandatory - no Job Card without invoice verification
- **OOW Approval**: Customer must approve via shareable link before WIP; reject = RWR
- **Delivery Block**: OOW delivery blocked unless paid (B2B Credit exception)
- **Interdepartment**: B2B-SalesChannel auto-generates Internal Debit Note at QC
- **No Payment Gateway**: Manual only (Cash, Card, Bank Transfer, B2B Credit 30-day)
- **VAT**: 5% UAE / 15% KSA by service centre location

## Next Implementation Steps

See `docs/planning/IMPLEMENTATION_PLAN_v1.md` for full 8-week plan:

1. **Week 1**: Foundation - Auth, Master Data, DB schema ✅
2. **Week 2**: Appointments + Technician Mobile API
3. **Week 3**: Job Cards + Warranty Check
4. **Week 4**: Estimates + Notifications
5. **Week 5**: Workshop + Inventory (Reserve)
6. **Week 6**: QC + Inventory (Auto-deduct, GRN block)
7. **Week 7**: Delivery + POD + OOW block
8. **Week 8**: Finance + Customer Portal

## Scripts

```bash
npm run start        # Production build
npm run start:dev    # Development with hot reload
npm run start:debug  # Debug mode
npm run build        # Build for production
npm run lint         # ESLint
npm run test         # Unit tests
npm run test:e2e     # E2E tests
npm run test:cov     # Coverage report
```

## Documentation

- **BRD**: `docs/brd/`
- **Discovery**: `docs/discovery/DISCOVERY_v1.md`
- **Implementation Plan**: `docs/planning/IMPLEMENTATION_PLAN_v1.md`

## Environment Variables

See `.env` for all configuration options. Key variables:

- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (min 32 chars, change in production!)
- `CORS_ORIGIN` - Comma-separated allowed origins
- External API keys for WhatsApp, Email, SMS, Warranty

## License

Private - Jacky's Distribution