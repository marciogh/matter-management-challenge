# Matter Management System

## AI Usage Disclosure

**This README has 100% manually written by me.**

This assessment has been completed with support of **Claude Sonnet 4.5 model**, via Visual Studio Claude Code for VS Code Anthropic plugin.

I have more than 20 years of software engineering experience. In the last 6 months I started leveraging AI into coding, with a mix feeling of amazement and frustration on how I'm more and more being outperformed by AI in general code quality and productivity.

The combination of my design, testing and project management experience and advanced IA usage has producing extremely positive yields in my current job position.

This is my current development workflow:

1) Breakdown the project into manageable chunks (for this assessment, it was already done)
2) Create and refine a plan MD file
3) Implement the plan
4) Test and refine the implementation
5) Summarize the implementation into another MD file

For this assessment, these artefacts have been produced:

- [TASK-1-CYCLETIME.md](TASK-1-CYCLETIME.md)
- [TASK-1-CYCLETIME-SUMMARY.md](TASK-1-CYCLETIME-SUMMARY.md)
- [TASK-2-SORTING.md](TASK-2-SORTING.md)
- [TASK-2-SORTING-SUMMARY.md](TASK-2-SORTING-SUMMARY.md)
- [TASK-3-SEARCH.md](TASK-3-SEARCH.md)
- [TASK-3-SEARCH-SUMMARY.md](TASK-3-SEARCH-SUMMARY.md)
- [TASK-DOCKER-PACKAGE-JSON.md](TASK-DOCKER-PACKAGE-JSON.md) issue I had with Docker
- [TASK-STORE-COMPUTED-SLA-DATA.md](TASK-STORE-COMPUTED-SLA-DATA.md) exploring storing computed fields, not implemented

# Cycle Time Tracking & SLA Calculation

When I started this task, straight away I identified it would be a sorting issue if it wasn't stored in the database. However, due time constraints for the assessment and also to deep dive in the system functionality and design, I decided to not implement it, and postpone the problem.

The tradeoff is documented on Sorting session below.

# Sorting

Sorting EAV fields implementation followed a common pattern using LEFT JOIN from `ticketing_ticket` to `ticketing_ticket_field_value`, with a `sort_query_builder.ts` dealing with different field schema scenarios.

## Potential improvements 

- I'm using COUNT query to provide precise pagination data. For larger datasets, we could switch to a infinite scroll / cursor solution.
- Postgres is performing in memory sort due the lack of indexes on field values. Example for a `subject(text)` sort:
 ```
 Sort  (cost=1866.20..1868.45 rows=900 width=62) (actual time=23.655..24.130 rows=10000 loops=1)
   Sort Key: ttfv.text_value
   Sort Method: quicksort  Memory: 1291kB
```
Exploring and creating indexes for `ticketing_ticket_field_values` would yeld performance results for the current schema
- `resolutionTime` and `sla` have been implemented on real time calculation, hence the sorting implementation has been duplicated, and is also buggy, which due time constraints, I didn't fix it. These fields should be calculated and stored in the database, perhaps using the `system_field` flag (making it not editable by users). 
- Computed fields would need proper hooks on `matter_repo.ts` for realtime creation/update, and also the architecture of a backtracking system, with concurrency and completion controls for rolling out changes. Said architecture has been explored in [TASK-STORE-COMPUTED-SLA-DATA.md](TASK-STORE-COMPUTED-SLA-DATA.md)

# Search

All UI/UX and debouncing I fully trusted AI and my manual tests. (I'm not a frontend person).

I paid attention on how multi tokens search input would behave, I decided to go with a broad approach, performing **OR** on every token, displaying more results than the user would probably want, instead of HIDING results.

## Improvements 

When testing the final implementation, I noticed that Postgres was not using `pg_trgm` and performing full scans instead. After quick research, it seems that `ILIKE` with `%` searchs (\*JOHN\*) work with trigram also requires the inverted index. Due to assessment time restriction, I didn't work on this.

# Scalability

## Logical Database partitioning

tickets could be split into different tables or different postgres databases (or schemas) using a logical high order classifier, such as board `ticketing_board`, or non functional order such as `created_at`

### Pros

- Would break down indexes and allows queries to scale on growth

### Cons

- Limited/complex search and sorting capabilites
- Complex Backups/Restores

## Horizontal database scalability (Preferred)

postgres has very stable replication mechanism which combined to AWS Aurora scalable persistent layers, allows a very elegant horizontal database scalability. However, that comes with the cost of eventual consistency.
[Amazon Aurora High Availability and Disaster Recovery Features for Global Resilience (PDF)](https://d1.awsstatic.com/Amazon%20Aurora%20High%20Availability%20and%20Disaster%20Recovery%20Features%20for%20Global%20Resilience%20Whitepaper.pdf)

### Pros

- Doesn't require logical changes, apart from dealing with eventual consistency (optmistic locks mostly)
- Scales infinitely (tm)

### Cons

- Cost
- Infra migration and Aurora management/observability

## postgres EAV to JSONB

postgres also has very elegant way to combine SQL and JSON, which, allied to Aurora horizontal scalability, would be my favourite long term direction for the ticketing storage solution.

To guarantee it would be a perfect replacement for EAV, I leverage Claude to refresh my skills, see:
- [POSTGRES-JSONB-DEEP-DIVE.md](POSTGRES-JSONB-DEEP-DIVE.md)
- [POSTGRES-JSONB-DEEP-DIVE-TRANSCRIPT.md](POSTGRES-JSONB-DEEP-DIVE-TRANSCRIPT.md)

That would require a comprehensive migration/backtracking logic, similar to what has been described above on Sorting to deal with computed fields. However it would definitely paid in the long term, as it offers perfect logical scalability for sparse matrix data as the ticketing model is.

## ElasticSearch

ElasticSearch is industry standard for search. Data should be shadowed async to ElasticSearch clusters and search (potentially sorting) should be deletaged. Not explored further due assesment time constraints.

## Integration tests

I like to use [Bruno](https://www.usebruno.com/) for API verification, as it allows the use cases to be in the repository (see `/bruno`)

It has extensive support to scripting and tests, I didn't implement it further due assessment time.

# End Assessment Results
# ---

# Matter Management System - Take-Home Assessment

Welcome! We're excited to see your approach to building a production-ready system.

## What You'll Be Building

You'll be enhancing a **Matter Management System** - a tool for legal teams to track cases and matters. We've provided a working foundation, and you'll implement the missing features.

**Time Expectation**: We've designed this assessment to explore a realistically large problem space - intentionally more than can be completed in one sitting. We don't expect you to solve everything! We respect your time and ask that you spend approximately **4-8 hours** building features and exploring the codebase. What we're most interested in is:
- Your approach to problem-solving and prioritization
- The quality and thoughtfulness of what you do build
- Your insights about the system, challenges you encountered, and trade-offs you considered
- What you would do differently with more time

Focus on showcasing your strengths rather than achieving completeness.  

---

## 📖 Start Here

### Step 1: Read the Instructions
👉 **[ASSESSMENT.md](./ASSESSMENT.md)** - Your main task list and requirements

### Step 2: Understand the Database
👉 **[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)** - Complete schema docs (READ THIS before coding!)

### Step 3: Quick Setup
👉 **[QUICKSTART.md](./QUICKSTART.md)** - Setup guide and troubleshooting

---

## 🚀 Quick Start

```bash
# 1. Verify you have Docker and prerequisites
./verify-setup.sh

# 2. Start everything (takes ~3 minutes to seed 10,000 matters)
docker compose up

# 3. Open the application
open http://localhost:8080

# 4. Check the API
curl http://localhost:3000/health
```

That's it! You now have a running application with 10,000 pre-seeded matters.

---

## 🎯 Your Tasks

We've intentionally left some features incomplete for you to implement:

### 1. ⏱️ Cycle Time & SLA Calculation
Implement logic to track how long matters take to resolve and whether they meet our 8-hour SLA.

**What you'll build**:
- Calculate resolution time from "To Do" → "Done"
- Determine SLA status (Met, Breached, In Progress)
- Display with color-coded badges in the UI

**Files to modify**:
- `backend/src/ticketing/matter/service/cycle_time_service.ts`
- `frontend/src/components/MatterTable.tsx`

### 2. 🔄 Column Sorting
Add sorting functionality to ALL table columns (currently only date sorting works).

**What you'll build**:
- Sort by numbers, text, dates, statuses, users, currency, booleans
- Handle NULL values appropriately
- Work with the EAV database pattern

**Files to modify**:
- `backend/src/ticketing/matter/repo/matter_repo.ts`
- `frontend/src/components/MatterTable.tsx`

### 3. 🔍 Search
Implement search across all fields using PostgreSQL full-text search.

**What you'll build**:
- Search text, numbers, status labels, user names
- Debounced search input (500ms)
- Use pg_trgm for fuzzy matching

**Files to modify**:
- `backend/src/ticketing/matter/repo/matter_repo.ts`
- `frontend/src/App.tsx` (add SearchBar component)

### 4. 🧪 Tests
Write comprehensive tests for your implementations.

**What you'll write**:
- Unit tests for cycle time logic
- Integration tests for API endpoints
- Edge case tests (NULL values, empty data)
- 80%+ coverage on business logic

**Directory**: `backend/src/ticketing/matter/service/__tests__/`

### 5. 📈 Scalability Documentation
Document how your solution would handle 10× the current load (100,000 matters, 1,000+ concurrent users).

**What to include**:
- Database optimization strategies
- Caching approaches
- Query optimization
- Specific, quantified recommendations

**File to update**: This README.md (add your analysis at the bottom)

---

## 🏗️ What We've Built For You

To save you time, we've provided a fully working foundation:

### Database (PostgreSQL)
- ✅ 11 tables with complete schema
- ✅ 10,000 pre-seeded matters with realistic data
- ✅ 8 field types (text, number, select, date, currency, boolean, status, user)
- ✅ Cycle time history tracking (for your implementation)
- ✅ Performance indexes (GIN, B-tree)
- ✅ pg_trgm extension enabled for search

### Backend (Node.js + TypeScript)
- ✅ Express API with proper structure
- ✅ Database connection pooling
- ✅ Basic CRUD endpoints (list, get, update)
- ✅ Error handling framework
- ✅ Winston logging configured
- ✅ Zod validation setup
- ✅ Vitest test configuration

### Frontend (React + TypeScript)
- ✅ React 18 with TypeScript
- ✅ Vite build tooling
- ✅ TailwindCSS styling
- ✅ Matter table with pagination
- ✅ Basic sorting UI (ready for your implementation)
- ✅ Loading and error states

### Infrastructure
- ✅ Docker Compose orchestration
- ✅ Automatic database seeding
- ✅ Health checks
- ✅ Development and production modes

---

## 📊 System Architecture

```
┌─────────────────┐
│   React SPA     │  ← Frontend (Port 8080)
│  (Vite + TS)    │     - Table with pagination
└────────┬────────┘     - YOU IMPLEMENT: Sorting, Search, Cycle Time display
         │
         │ HTTP/REST
         │
┌────────▼────────┐
│  Express API    │  ← Backend (Port 3000)
│  (Node.js + TS) │     - Basic CRUD endpoints
└────────┬────────┘     - YOU IMPLEMENT: Sorting, Search, Cycle Time service
         │
         │ pg (connection pool)
         │
┌────────▼────────┐
│  PostgreSQL 15  │  ← Database (Port 5432)
│  + pg_trgm      │     - 10,000 seeded matters
└─────────────────┘     - Complete schema ready
```

---

## 💾 Database Schema (Quick Overview)

We use an **Entity-Attribute-Value (EAV)** pattern for flexible field definitions. This is important to understand for your sorting and search implementations!

### Key Tables (11 total)

| Table | Purpose | Rows Seeded |
|-------|---------|-------------|
| `ticketing_ticket` | Matter records | 10,000 |
| `ticketing_ticket_field_value` | Field values (EAV table) | ~90,000 |
| `ticketing_fields` | Field definitions | 9 |
| `ticketing_cycle_time_histories` | Status transitions | Variable |
| `ticketing_field_status_groups` | Status groups (To Do, In Progress, Done) | 3 |
| `users` | User assignments | 5 |
| ... + 5 more tables | Options, currencies, etc. | Various |

### 8 Field Types

| Type | Storage Column | Example |
|------|----------------|---------|
| `text` | `text_value` or `string_value` | Subject, Description |
| `number` | `number_value` | Case Number |
| `select` | `select_reference_value_uuid` | Priority |
| `date` | `date_value` | Due Date |
| `currency` | `currency_value` (JSONB) | Contract Value |
| `boolean` | `boolean_value` | Urgent flag |
| `status` | `status_reference_value_uuid` | Matter Status |
| `user` | `user_value` | Assigned To |

**📖 Full Details**: See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for:
- Complete table schemas with column descriptions
- EAV pattern explanation
- Sample SQL queries for sorting and search
- Performance optimization tips
- Index documentation

---

## 🛠️ Development Commands

```bash
# Start everything
docker compose up

# Start in development mode (with hot reload)
docker compose -f docker-compose.dev.yml up

# View logs
docker compose logs -f backend

# Stop services
docker compose down

# Clean up (removes data)
docker compose down -v

# Run tests
cd backend && npm test

# Build frontend
cd frontend && npm run build

# Build backend
cd backend && npm run build
```

---

## 🔌 API Endpoints

### What's Implemented

```http
GET /health
GET /api/v1/fields
GET /api/v1/matters?page=1&limit=25&sortBy=created_at&sortOrder=desc
GET /api/v1/matters/:id
PATCH /api/v1/matters/:id
```

**Note**: `sortBy` currently only supports `created_at` and `updated_at`. You'll add support for field-based sorting (case_number, status, etc.).

### What You'll Add

**Sorting**:
```http
GET /api/v1/matters?sortBy=case_number&sortOrder=asc
GET /api/v1/matters?sortBy=status&sortOrder=desc
```

**Search**:
```http
GET /api/v1/matters?search=contract&page=1&limit=25
```

**Cycle Time/SLA** (added to response):
```json
{
  "data": [{
    "id": "uuid",
    "fields": { ... },
    "cycleTime": {
      "resolutionTimeMs": 14400000,
      "resolutionTimeFormatted": "4h",
      "isInProgress": false
    },
    "sla": "Met"
  }]
}
```

---

## 🧪 Testing

We've configured Vitest for you. You'll write the actual tests.

**Run tests**:
```bash
cd backend
npm test

# With coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

**What to test**:
- ✅ Cycle time calculations (NULL handling, edge cases)
- ✅ SLA determination logic
- ✅ Sorting with different field types
- ✅ Search across all fields
- ✅ API endpoints (integration tests)
- ✅ Error conditions

**Test location**: `backend/src/ticketing/matter/service/__tests__/`

---

## 🤖 AI Tool Usage

**You may use AI tools** (GitHub Copilot, ChatGPT, Claude, etc.), but:

### ✅ We Expect
- Honest disclosure of which tools you used
- Explanation of what was AI-generated vs. human-written
- Justification for using AI for specific parts
- **Full accountability** for all submitted code

### ❌ Unacceptable
- Blindly copying AI output without review
- Submitting code you don't understand
- Not testing AI-generated code

### Good Example Disclosure
> "I used GitHub Copilot to generate the initial cycle time query structure, but I rewrote the NULL handling logic and added edge case tests manually. The duration formatting function was AI-assisted but I modified it to handle our specific requirements (in-progress matters, very large durations). I am confident in the correctness and can explain every line."

---

## ✅ Submission Checklist

Before you submit, make sure:

### Implementation
- [ ] Cycle time & SLA working correctly
- [ ] Sorting works for ALL columns
- [ ] Search works across all field types
- [ ] Tests written with good coverage
- [ ] Edge cases handled (NULL, empty, missing data)

### Code Quality
- [ ] No TypeScript errors (`npm run build` succeeds in both backend & frontend)
- [ ] No linting errors (`npm run lint` passes)
- [ ] Code follows existing patterns
- [ ] Clear variable and function names
- [ ] Error handling throughout

### Documentation
- [ ] README.md updated with your approach
- [ ] Scalability analysis included (specific, quantified)
- [ ] AI tool usage disclosed (if applicable)
- [ ] Trade-offs explained
- [ ] Setup instructions verified

### Testing
- [ ] Application runs with `docker compose up`
- [ ] Tests pass with `npm test`
- [ ] Edge cases tested
- [ ] Integration tests included

### Performance
- [ ] No N+1 query problems
- [ ] Efficient SQL queries
- [ ] Proper index usage
- [ ] Connection pooling configured

---

## 📂 Project Structure

```
matter-management-mvp/
├── README.md                    ← You're here!
├── ASSESSMENT.md                ← Task instructions
├── DATABASE_SCHEMA.md           ← Schema docs (read this!)
├── QUICKSTART.md                ← Setup guide
├── verify-setup.sh              ← Prerequisites checker
│
├── backend/
│   ├── src/
│   │   ├── ticketing/
│   │   │   ├── matter/
│   │   │   │   ├── service/
│   │   │   │   │   ├── cycle_time_service.ts    ← IMPLEMENT: Cycle time
│   │   │   │   │   ├── matter_service.ts
│   │   │   │   │   └── __tests__/               ← ADD: Your tests
│   │   │   │   ├── repo/
│   │   │   │   │   └── matter_repo.ts           ← IMPLEMENT: Sorting & search
│   │   │   │   ├── handlers/
│   │   │   │   │   ├── getMatters.ts
│   │   │   │   │   ├── getMatterDetails.ts
│   │   │   │   │   ├── updateMatter.ts
│   │   │   │   │   └── getFields.ts
│   │   │   │   └── routes.ts
│   │   │   ├── fields/
│   │   │   │   └── repo/fields_repo.ts
│   │   │   └── types.ts
│   │   ├── db/pool.ts
│   │   ├── utils/
│   │   │   ├── config.ts
│   │   │   └── logger.ts
│   │   └── app.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx                      ← ADD: SearchBar component
│   │   ├── components/
│   │   │   ├── MatterTable.tsx          ← IMPLEMENT: Sort handlers, cycle time/SLA display
│   │   │   └── Pagination.tsx
│   │   ├── hooks/
│   │   │   └── useMatters.ts
│   │   ├── types/
│   │   │   └── matter.ts
│   │   └── utils/
│   │       └── formatting.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── Dockerfile
│
├── database/
│   ├── schema.sql               ← Complete schema
│   ├── seed.js                  ← Seeds 10,000 matters
│   ├── package.json
│   └── Dockerfile
│
└── docker-compose.yml           ← Main compose file
```

---

## 🎓 What We're Looking For

We evaluate across these dimensions:

### 1. Code Quality (25%)
- Clean, maintainable code
- TypeScript best practices
- Follows SOLID principles
- Consistent patterns

### 2. Production Readiness (20%)
- Comprehensive error handling
- Input validation
- Logging with context
- Edge case handling

### 3. Security (15%)
- SQL injection prevention
- Input sanitization
- Safe error messages

### 4. Testing (20%)
- Unit and integration tests
- Edge case coverage
- Test quality and design

### 5. System Design (15%)
- Query optimization
- Scalability thinking
- Caching strategy
- Trade-off awareness

### 6. Documentation (5%)
- Clear explanations
- Decision justifications
- Scalability analysis

---

## 💡 Tips for Success

1. **Read DATABASE_SCHEMA.md first** - Understanding the EAV pattern is critical
2. **Start with cycle times** - It's the foundation for other features
3. **Test as you go** - Don't wait until the end
4. **Think production** - This is meant to be production-ready code
5. **Document your thinking** - Explain WHY, not just WHAT
6. **Be honest about AI** - We value transparency
7. **Manage your time** - 4-8 hours total, prioritize accordingly

---

## ❓ Questions?

- **Setup issues?** See [QUICKSTART.md](./QUICKSTART.md)
- **Schema questions?** See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
- **Task unclear?** Document your assumptions in your submission
- **Found a bug in the boilerplate?** Note it in your README

We're interested in how you think through ambiguity. Make reasonable assumptions and document them.

---

## 🚀 Ready to Start?

1. ✅ Read [ASSESSMENT.md](./ASSESSMENT.md) for detailed requirements
2. ✅ Review [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) to understand the data model
3. ✅ Run `docker compose up` to start the system
4. ✅ Start coding!

**Good luck! We're excited to see your solution.** 🎉

---

**Happy coding! 🚀**
