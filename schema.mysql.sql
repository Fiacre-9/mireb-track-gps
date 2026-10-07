CREATE TABLE IF NOT EXISTS companies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  brand_name VARCHAR(120) NULL,
  brand_color VARCHAR(9) NOT NULL DEFAULT '#2563eb',
  logo_url VARCHAR(500) NULL,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NULL,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  lang VARCHAR(5) NOT NULL DEFAULT 'fr',
  active TINYINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  INDEX idx_users_company (company_id),
  CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vehicles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  plate VARCHAR(40) NOT NULL DEFAULT '',
  imei VARCHAR(32) NOT NULL UNIQUE,
  token VARCHAR(40) NOT NULL,
  speed_limit INT NOT NULL DEFAULT 80,
  lat DOUBLE NULL,
  lng DOUBLE NULL,
  speed INT NOT NULL DEFAULT 0,
  heading INT NOT NULL DEFAULT 0,
  acc TINYINT NOT NULL DEFAULT 0,
  fuel DOUBLE NULL,
  temp DOUBLE NULL,
  online TINYINT NOT NULL DEFAULT 0,
  cut TINYINT NOT NULL DEFAULT 0,
  last_update BIGINT NULL,
  static_since BIGINT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_vehicles_company (company_id),
  CONSTRAINT fk_vehicles_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS positions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id INT NOT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  speed INT NOT NULL DEFAULT 0,
  t BIGINT NOT NULL,
  INDEX idx_positions_vehicle_t (vehicle_id, t),
  INDEX idx_positions_t (t),
  CONSTRAINT fk_positions_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS geofences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  radius INT NOT NULL,
  on_enter TINYINT NOT NULL DEFAULT 1,
  on_exit TINYINT NOT NULL DEFAULT 1,
  cut_on_exit TINYINT NOT NULL DEFAULT 0,
  speed_limit INT NULL,
  INDEX idx_geofences_company (company_id),
  CONSTRAINT fk_geofences_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS alerts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  type VARCHAR(30) NOT NULL,
  detail VARCHAR(255) NOT NULL DEFAULT '',
  lat DOUBLE NULL,
  lng DOUBLE NULL,
  t BIGINT NOT NULL,
  INDEX idx_alerts_company_t (company_id, t),
  INDEX idx_alerts_vehicle_t (vehicle_id, t),
  CONSTRAINT fk_alerts_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS commands (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  vehicle_id INT NOT NULL,
  user_id INT NULL,
  command VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'sent',
  t BIGINT NOT NULL,
  INDEX idx_commands_vehicle_t (vehicle_id, t),
  CONSTRAINT fk_commands_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
