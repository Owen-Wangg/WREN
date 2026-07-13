-- Identity mapping tables (source of truth for roles)
-- Maps Cognito subjects to app identities and stores all authorization data

CREATE TABLE IF NOT EXISTS user_identities (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  
  -- Maps to Cognito sub claim (e.g., "us-east-1_abc123:user@example.com")
  cognito_subject VARCHAR(500) NOT NULL UNIQUE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_identities_cognito_subject 
  ON user_identities(cognito_subject);

-- Source of truth for all user roles and permissions
CREATE TABLE IF NOT EXISTS user_roles (
  user_role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_identities(user_id) ON DELETE CASCADE,
  
  -- Role: 'Student', 'DepartmentAdmin', 'TechnicalAdmin'
  role VARCHAR(50) NOT NULL,
  
  -- Scope of the role
  scope_kind VARCHAR(50),  -- 'platform', 'department', NULL
  scope_id UUID,           -- department_id if scope_kind='department'
  
  assigned_at TIMESTAMP DEFAULT NOW(),
  assigned_by UUID REFERENCES user_identities(user_id),
  
  UNIQUE(user_id, role, scope_kind, scope_id)
);

CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role);

-- Example: How roles are stored
-- 
-- Student globally:
--   user_id: uuid-1, role: 'Student', scope_kind: NULL, scope_id: NULL
--
-- DepartmentAdmin for departments A and B:
--   user_id: uuid-2, role: 'DepartmentAdmin', scope_kind: 'department', scope_id: dept-a-uuid
--   user_id: uuid-2, role: 'DepartmentAdmin', scope_kind: 'department', scope_id: dept-b-uuid
--
-- TechnicalAdmin globally:
--   user_id: uuid-3, role: 'TechnicalAdmin', scope_kind: NULL, scope_id: NULL
