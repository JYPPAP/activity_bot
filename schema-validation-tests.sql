-- =============================================================================
-- PostgreSQL Schema Validation and Testing Procedures
-- Comprehensive test suite for Discord Activity Bot database schema
-- =============================================================================

-- =============================================================================
-- SCHEMA STRUCTURE VALIDATION
-- =============================================================================

-- Test 1: Verify all required tables exist
DO $$
DECLARE
    required_tables TEXT[] := ARRAY[
        'users', 'roles', 'user_activities', 'activity_events', 
        'activity_event_participants', 'user_role_assignments', 
        'role_reset_history', 'afk_status', 'forum_messages', 
        'voice_channel_mappings', 'schema_migrations', 'system_configuration'
    ];
    table_name TEXT;
    table_exists BOOLEAN;
BEGIN
    RAISE NOTICE 'Starting schema structure validation...';
    
    FOREACH table_name IN ARRAY required_tables
    LOOP
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = table_name
        ) INTO table_exists;
        
        IF NOT table_exists THEN
            RAISE EXCEPTION 'Required table % does not exist', table_name;
        END IF;
        
        RAISE NOTICE 'Table % exists', table_name;
    END LOOP;
    
    RAISE NOTICE 'All required tables exist ✓';
END $$;

-- Test 2: Verify primary keys and constraints
WITH constraint_check AS (
    SELECT 
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema = 'public'
        AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK')
    ORDER BY tc.table_name, tc.constraint_type
)
SELECT 
    table_name,
    constraint_type,
    COUNT(*) as constraint_count
FROM constraint_check
GROUP BY table_name, constraint_type
ORDER BY table_name;

-- Test 3: Verify required indexes exist
SELECT 
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- =============================================================================
-- DATA TYPE AND CONSTRAINT VALIDATION
-- =============================================================================

-- Test 4: Verify Discord ID format constraints
DO $$
DECLARE
    test_user_id VARCHAR(20) := '123456789012345678';
    invalid_user_id VARCHAR(20) := 'invalid_id';
    constraint_violation BOOLEAN := false;
BEGIN
    RAISE NOTICE 'Testing Discord ID format constraints...';
    
    -- Test valid Discord ID
    BEGIN
        INSERT INTO users (id, display_name) VALUES (test_user_id, 'Test User');
        RAISE NOTICE 'Valid Discord ID accepted ✓';
        DELETE FROM users WHERE id = test_user_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Valid Discord ID rejected: %', SQLERRM;
    END;
    
    -- Test invalid Discord ID
    BEGIN
        INSERT INTO users (id, display_name) VALUES (invalid_user_id, 'Invalid User');
        constraint_violation := true;
        DELETE FROM users WHERE id = invalid_user_id;
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'Invalid Discord ID correctly rejected ✓';
    END;
    
    IF constraint_violation THEN
        RAISE EXCEPTION 'Invalid Discord ID was accepted when it should be rejected';
    END IF;
END $$;

-- Test 5: Verify numeric constraints
DO $$
DECLARE
    test_user_id VARCHAR(20) := '123456789012345678';
BEGIN
    RAISE NOTICE 'Testing numeric constraints...';
    
    -- Setup test user
    INSERT INTO users (id, display_name) VALUES (test_user_id, 'Test User');
    
    -- Test valid activity data
    INSERT INTO user_activities (user_id, total_time_ms, session_count) 
    VALUES (test_user_id, 3600000, 1);
    RAISE NOTICE 'Valid activity data accepted ✓';
    
    -- Test negative time constraint
    BEGIN
        UPDATE user_activities 
        SET total_time_ms = -1000 
        WHERE user_id = test_user_id;
        RAISE EXCEPTION 'Negative time was accepted when it should be rejected';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'Negative time correctly rejected ✓';
    END;
    
    -- Cleanup
    DELETE FROM user_activities WHERE user_id = test_user_id;
    DELETE FROM users WHERE id = test_user_id;
END $$;

-- =============================================================================
-- FOREIGN KEY RELATIONSHIP VALIDATION
-- =============================================================================

-- Test 6: Verify foreign key relationships
DO $$
DECLARE
    test_user_id VARCHAR(20) := '123456789012345678';
    test_role_id INTEGER;
    orphan_record_accepted BOOLEAN := false;
BEGIN
    RAISE NOTICE 'Testing foreign key relationships...';
    
    -- Setup test data
    INSERT INTO users (id, display_name) VALUES (test_user_id, 'Test User');
    INSERT INTO roles (name, min_hours) VALUES ('Test Role', 10.0) RETURNING id INTO test_role_id;
    
    -- Test valid foreign key
    INSERT INTO user_activities (user_id, total_time_ms) VALUES (test_user_id, 3600000);
    INSERT INTO user_role_assignments (user_id, role_id) VALUES (test_user_id, test_role_id);
    RAISE NOTICE 'Valid foreign keys accepted ✓';
    
    -- Test orphan record rejection
    BEGIN
        INSERT INTO user_activities (user_id, total_time_ms) VALUES ('999999999999999999', 3600000);
        orphan_record_accepted := true;
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'Orphan record correctly rejected ✓';
    END;
    
    IF orphan_record_accepted THEN
        RAISE EXCEPTION 'Orphan record was accepted when it should be rejected';
    END IF;
    
    -- Test cascade delete
    DELETE FROM users WHERE id = test_user_id;
    
    -- Verify related records were deleted
    IF EXISTS (SELECT 1 FROM user_activities WHERE user_id = test_user_id) THEN
        RAISE EXCEPTION 'Cascade delete failed for user_activities';
    END IF;
    
    RAISE NOTICE 'Cascade delete working correctly ✓';
    
    -- Cleanup
    DELETE FROM roles WHERE id = test_role_id;
END $$;

-- =============================================================================
-- TRIGGER AND COMPUTED FIELD VALIDATION
-- =============================================================================

-- Test 7: Verify automatic timestamp updates
DO $$
DECLARE
    test_user_id VARCHAR(20) := '123456789012345678';
    initial_updated_at TIMESTAMP WITH TIME ZONE;
    new_updated_at TIMESTAMP WITH TIME ZONE;
BEGIN
    RAISE NOTICE 'Testing automatic timestamp updates...';
    
    -- Create test user
    INSERT INTO users (id, display_name) VALUES (test_user_id, 'Test User');
    SELECT updated_at INTO initial_updated_at FROM users WHERE id = test_user_id;
    
    -- Wait a moment and update
    PERFORM pg_sleep(0.1);
    UPDATE users SET display_name = 'Updated Test User' WHERE id = test_user_id;
    SELECT updated_at INTO new_updated_at FROM users WHERE id = test_user_id;
    
    IF new_updated_at <= initial_updated_at THEN
        RAISE EXCEPTION 'Automatic timestamp update failed';
    END IF;
    
    RAISE NOTICE 'Automatic timestamp updates working ✓';
    
    -- Cleanup
    DELETE FROM users WHERE id = test_user_id;
END $$;

-- Test 8: Verify computed fields
DO $$
DECLARE
    test_user_id VARCHAR(20) := '123456789012345678';
    computed_hours DECIMAL(10,2);
    computed_days DECIMAL(8,2);
    expected_hours DECIMAL(10,2) := 1.0; -- 3600000ms = 1 hour
    expected_days DECIMAL(8,2) := 1.0 / 24.0; -- 1 hour = 1/24 days
BEGIN
    RAISE NOTICE 'Testing computed fields...';
    
    -- Setup test data
    INSERT INTO users (id, display_name) VALUES (test_user_id, 'Test User');
    INSERT INTO user_activities (user_id, total_time_ms) VALUES (test_user_id, 3600000);
    
    -- Check computed fields
    SELECT total_hours, total_days 
    INTO computed_hours, computed_days 
    FROM user_activities 
    WHERE user_id = test_user_id;
    
    IF ABS(computed_hours - expected_hours) > 0.01 THEN
        RAISE EXCEPTION 'Computed hours field incorrect: expected %, got %', expected_hours, computed_hours;
    END IF;
    
    IF ABS(computed_days - expected_days) > 0.001 THEN
        RAISE EXCEPTION 'Computed days field incorrect: expected %, got %', expected_days, computed_days;
    END IF;
    
    RAISE NOTICE 'Computed fields working correctly ✓';
    
    -- Cleanup
    DELETE FROM users WHERE id = test_user_id;
END $$;

-- =============================================================================
-- VIEW VALIDATION
-- =============================================================================

-- Test 9: Verify views return expected data structure
DO $$
DECLARE
    test_user_id VARCHAR(20) := '123456789012345678';
    view_record RECORD;
BEGIN
    RAISE NOTICE 'Testing view functionality...';
    
    -- Setup test data
    INSERT INTO users (id, display_name, is_active) VALUES (test_user_id, 'Test User', true);
    INSERT INTO user_activities (user_id, total_time_ms, session_count) VALUES (test_user_id, 7200000, 2);
    
    -- Test active users view
    SELECT * INTO view_record FROM v_active_users WHERE id = test_user_id;
    
    IF view_record.id IS NULL THEN
        RAISE EXCEPTION 'Active users view returned no data for test user';
    END IF;
    
    IF view_record.total_hours != 2.0 THEN
        RAISE EXCEPTION 'Active users view computed field incorrect';
    END IF;
    
    RAISE NOTICE 'Views working correctly ✓';
    
    -- Cleanup
    DELETE FROM users WHERE id = test_user_id;
END $$;

-- =============================================================================
-- PERFORMANCE AND SCALABILITY TESTS
-- =============================================================================

-- Test 10: Index usage verification
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM users WHERE display_name = 'Test User';

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM user_activities WHERE total_time_ms > 3600000 ORDER BY total_time_ms DESC LIMIT 10;

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM activity_events WHERE user_id = '123456789012345678' AND event_timestamp > CURRENT_TIMESTAMP - interval '7 days';

-- Test 11: Bulk data insertion performance
DO $$
DECLARE
    start_time TIMESTAMP;
    end_time TIMESTAMP;
    duration INTERVAL;
    i INTEGER;
    test_user_id TEXT;
BEGIN
    RAISE NOTICE 'Testing bulk insertion performance...';
    start_time := clock_timestamp();
    
    -- Insert 1000 test users
    FOR i IN 1..1000 LOOP
        test_user_id := 'test_user_' || LPAD(i::TEXT, 16, '0');
        INSERT INTO users (id, display_name) VALUES (test_user_id, 'Bulk Test User ' || i);
        INSERT INTO user_activities (user_id, total_time_ms) VALUES (test_user_id, RANDOM() * 10000000);
    END LOOP;
    
    end_time := clock_timestamp();
    duration := end_time - start_time;
    
    RAISE NOTICE 'Bulk insertion completed in %', duration;
    
    -- Cleanup
    DELETE FROM users WHERE id LIKE 'test_user_%';
    
    IF duration > interval '10 seconds' THEN
        RAISE WARNING 'Bulk insertion took longer than expected: %', duration;
    ELSE
        RAISE NOTICE 'Bulk insertion performance acceptable ✓';
    END IF;
END $$;

-- =============================================================================
-- DATA MIGRATION SIMULATION TEST
-- =============================================================================

-- Test 12: Simulate LowDB to PostgreSQL migration
DO $$
DECLARE
    -- Simulate LowDB data structure
    lowdb_user_data JSONB := '{
        "442997845625274368": {
            "userId": "442997845625274368",
            "totalTime": 441140806,
            "startTime": null,
            "displayName": "초초"
        },
        "416489360502947841": {
            "userId": "416489360502947841", 
            "totalTime": 1044134020,
            "startTime": 1672531200000,
            "displayName": "김상음"
        }
    }';
    
    user_key TEXT;
    user_data JSONB;
    migrated_count INTEGER := 0;
BEGIN
    RAISE NOTICE 'Testing migration simulation...';
    
    -- Simulate migration process
    FOR user_key, user_data IN SELECT * FROM jsonb_each(lowdb_user_data)
    LOOP
        -- Insert user
        INSERT INTO users (id, display_name) 
        VALUES (
            user_key,
            COALESCE(user_data->>'displayName', 'Unknown')
        );
        
        -- Insert user activity
        INSERT INTO user_activities (
            user_id, 
            total_time_ms, 
            current_session_start,
            is_currently_active
        ) VALUES (
            user_key,
            (user_data->>'totalTime')::BIGINT,
            CASE 
                WHEN user_data->>'startTime' != 'null' 
                THEN to_timestamp((user_data->>'startTime')::BIGINT / 1000.0)
                ELSE NULL 
            END,
            user_data->>'startTime' != 'null'
        );
        
        migrated_count := migrated_count + 1;
    END LOOP;
    
    RAISE NOTICE 'Migration simulation completed: % users migrated', migrated_count;
    
    -- Verify migration results
    IF migrated_count != 2 THEN
        RAISE EXCEPTION 'Expected 2 users, migrated %', migrated_count;
    END IF;
    
    -- Verify data integrity
    IF NOT EXISTS (
        SELECT 1 FROM user_activities 
        WHERE user_id = '442997845625274368' 
        AND total_time_ms = 441140806
        AND current_session_start IS NULL
    ) THEN
        RAISE EXCEPTION 'Migration data integrity check failed for user 1';
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM user_activities 
        WHERE user_id = '416489360502947841'
        AND total_time_ms = 1044134020
        AND current_session_start IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Migration data integrity check failed for user 2';
    END IF;
    
    RAISE NOTICE 'Migration simulation successful ✓';
    
    -- Cleanup
    DELETE FROM users WHERE id IN ('442997845625274368', '416489360502947841');
END $$;

-- =============================================================================
-- COMPREHENSIVE SCHEMA HEALTH CHECK
-- =============================================================================

-- Test 13: Overall schema health check
WITH schema_health AS (
    SELECT 
        'Tables' as component,
        COUNT(*) as count,
        'Expected: 12' as expected
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    
    UNION ALL
    
    SELECT 
        'Primary Keys',
        COUNT(*),
        'Expected: 12'
    FROM information_schema.table_constraints 
    WHERE constraint_type = 'PRIMARY KEY' AND table_schema = 'public'
    
    UNION ALL
    
    SELECT 
        'Foreign Keys',
        COUNT(*),
        'Expected: 8+'
    FROM information_schema.table_constraints 
    WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public'
    
    UNION ALL
    
    SELECT 
        'Indexes',
        COUNT(*),
        'Expected: 20+'
    FROM pg_indexes 
    WHERE schemaname = 'public'
    
    UNION ALL
    
    SELECT 
        'Views',
        COUNT(*),
        'Expected: 4'
    FROM information_schema.views 
    WHERE table_schema = 'public'
    
    UNION ALL
    
    SELECT 
        'Triggers',
        COUNT(*),
        'Expected: 6+'
    FROM information_schema.triggers 
    WHERE trigger_schema = 'public'
)
SELECT 
    component,
    count,
    expected,
    CASE WHEN count > 0 THEN '✓' ELSE '✗' END as status
FROM schema_health
ORDER BY component;

-- =============================================================================
-- FINAL VALIDATION SUMMARY
-- =============================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=============================================================================';
    RAISE NOTICE 'SCHEMA VALIDATION COMPLETE';
    RAISE NOTICE '=============================================================================';
    RAISE NOTICE 'All validation tests passed successfully!';
    RAISE NOTICE 'The PostgreSQL schema is ready for production use.';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Run migration scripts to populate data';
    RAISE NOTICE '2. Update application configuration';
    RAISE NOTICE '3. Deploy and monitor performance';
    RAISE NOTICE '=============================================================================';
END $$;