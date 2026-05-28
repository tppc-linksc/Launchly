CREATE TABLE IF NOT EXISTS test_cases (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    title VARCHAR(500) NOT NULL,
    module VARCHAR(200),
    steps TEXT,
    expected_result TEXT,
    priority VARCHAR(10) NOT NULL DEFAULT 'P2',
    tags VARCHAR(500),
    owner_id VARCHAR(36),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS test_runs (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    deployment_id VARCHAR(36) NOT NULL,
    environment_id VARCHAR(36),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_by VARCHAR(36),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS test_run_cases (
    id VARCHAR(36) PRIMARY KEY,
    test_run_id VARCHAR(36) NOT NULL,
    test_case_id VARCHAR(36) NOT NULL,
    result VARCHAR(20) NOT NULL DEFAULT 'SKIPPED',
    notes TEXT,
    executed_by VARCHAR(36),
    executed_at TIMESTAMP
);

CREATE INDEX idx_test_cases_project ON test_cases(project_id);
CREATE INDEX idx_test_runs_project ON test_runs(project_id);
CREATE INDEX idx_test_runs_deployment ON test_runs(deployment_id);
CREATE INDEX idx_test_run_cases_run ON test_run_cases(test_run_id);
