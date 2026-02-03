-- Matter Management MVP Database Schema

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Accounts table
CREATE TABLE accounts (
    account_id SERIAL PRIMARY KEY,
    account_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(account_id),
    email VARCHAR(255) NOT NULL UNIQUE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Ticketing board table
CREATE TABLE ticketing_board (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(account_id),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Field status groups (To Do, In Progress, Done)
CREATE TABLE ticketing_field_status_groups (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(account_id),
    name VARCHAR(255) NOT NULL,
    sequence INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_by INTEGER NOT NULL REFERENCES users(id),
    deleted_by INTEGER REFERENCES users(id)
);

-- Field definitions
CREATE TABLE ticketing_fields (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(account_id),
    name VARCHAR(255) NOT NULL,
    field_type VARCHAR(50) NOT NULL CHECK (field_type IN ('text', 'number', 'select', 'date', 'currency', 'boolean', 'status', 'user')),
    description TEXT,
    metadata JSONB,
    system_field BOOLEAN DEFAULT FALSE NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_by INTEGER NOT NULL REFERENCES users(id),
    deleted_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Select field options
CREATE TABLE ticketing_field_options (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    ticket_field_id UUID NOT NULL REFERENCES ticketing_fields(id),
    label VARCHAR(255) NOT NULL,
    sequence INTEGER NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_by INTEGER NOT NULL REFERENCES users(id),
    deleted_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Status field options (linked to status groups)
CREATE TABLE ticketing_field_status_options (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    ticket_field_id UUID NOT NULL REFERENCES ticketing_fields(id),
    group_id UUID NOT NULL REFERENCES ticketing_field_status_groups(id),
    label VARCHAR(255) NOT NULL,
    sequence INTEGER NOT NULL,
    metadata JSONB,
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_by INTEGER NOT NULL REFERENCES users(id),
    deleted_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    restored_at TIMESTAMP WITH TIME ZONE,
    restored_by INTEGER REFERENCES users(id)
);

-- Currency options
CREATE TABLE ticketing_currency_field_options (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(account_id),
    code VARCHAR(8) NOT NULL,
    name VARCHAR(64) NOT NULL,
    symbol VARCHAR(8) NOT NULL,
    sequence INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Ticketing tickets (matters)
CREATE TABLE ticketing_ticket (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    board_id UUID NOT NULL REFERENCES ticketing_board(id),
    platform_type VARCHAR(50) DEFAULT 'web' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Ticket field values (EAV pattern)
CREATE TABLE ticketing_ticket_field_value (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES ticketing_ticket(id) ON DELETE CASCADE,
    ticket_field_id UUID NOT NULL REFERENCES ticketing_fields(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    updated_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    -- Value columns for different field types
    text_value TEXT,
    string_value VARCHAR(255),
    number_value NUMERIC,
    date_value TIMESTAMP WITH TIME ZONE,
    user_value INTEGER REFERENCES users(id),
    boolean_value BOOLEAN,
    currency_value JSONB, -- {amount: number, currency: string}
    select_reference_value_uuid UUID REFERENCES ticketing_field_options(id),
    status_reference_value_uuid UUID REFERENCES ticketing_field_status_options(id),
    UNIQUE(ticket_id, ticket_field_id)
);

-- Cycle time history for tracking status transitions
CREATE TABLE ticketing_cycle_time_histories (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES ticketing_ticket(id) ON DELETE CASCADE,
    status_field_id UUID NOT NULL REFERENCES ticketing_fields(id),
    from_status_id UUID REFERENCES ticketing_field_status_options(id),
    to_status_id UUID NOT NULL REFERENCES ticketing_field_status_options(id),
    transitioned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_ticketing_ticket_board_id ON ticketing_ticket(board_id);
CREATE INDEX idx_ticket_field_value_ticket_id ON ticketing_ticket_field_value(ticket_id);
CREATE INDEX idx_ticket_field_value_field_id ON ticketing_ticket_field_value(ticket_field_id);
CREATE INDEX idx_ticket_field_value_status_ref ON ticketing_ticket_field_value(status_reference_value_uuid);
CREATE INDEX idx_cycle_time_histories_ticket_id ON ticketing_cycle_time_histories(ticket_id);
CREATE INDEX idx_cycle_time_histories_status_field ON ticketing_cycle_time_histories(status_field_id);
CREATE INDEX idx_cycle_time_histories_to_status ON ticketing_cycle_time_histories(to_status_id);

-- Indexes for text search
CREATE INDEX idx_ticket_field_value_text_trgm ON ticketing_ticket_field_value USING gin (text_value gin_trgm_ops);
CREATE INDEX idx_ticket_field_value_string_trgm ON ticketing_ticket_field_value USING gin (string_value gin_trgm_ops);

-- Indexes for sorting and filtering
CREATE INDEX idx_ticket_field_value_number ON ticketing_ticket_field_value(number_value);
CREATE INDEX idx_ticket_field_value_date ON ticketing_ticket_field_value(date_value);
CREATE INDEX idx_ticketing_ticket_created_at ON ticketing_ticket(created_at);

-- Composite indexes for EAV sort performance (field_id + value column)
CREATE INDEX idx_ttfv_sort_number ON ticketing_ticket_field_value(ticket_field_id, number_value);
CREATE INDEX idx_ttfv_sort_date ON ticketing_ticket_field_value(ticket_field_id, date_value);
CREATE INDEX idx_ttfv_sort_string ON ticketing_ticket_field_value(ticket_field_id, string_value);
CREATE INDEX idx_ttfv_sort_boolean ON ticketing_ticket_field_value(ticket_field_id, boolean_value);

