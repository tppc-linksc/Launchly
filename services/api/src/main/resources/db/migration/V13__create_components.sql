CREATE TABLE components (
    id          VARCHAR(36) PRIMARY KEY,
    project_id  VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    repository_url VARCHAR(512),
    build_command VARCHAR(512),
    start_command VARCHAR(512),
    health_check_path VARCHAR(255),
    default_port INTEGER,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_components_project_id ON components(project_id);

-- Create a default component for each existing project
INSERT INTO components (id, project_id, name, is_default, created_at, updated_at)
SELECT gen_random_uuid(), id, 'default', TRUE, NOW(), NOW()
FROM projects;
