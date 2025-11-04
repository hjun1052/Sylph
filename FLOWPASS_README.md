# FlowPass - Sylph Password Manager

FlowPass is a built-in password manager for Sylph browser with secure encryption and autofill capabilities.

## 🎉 Implementation Status

### ✅ Phase 1: Core Backend (Completed)

1. **Cryptographic System** (`src/flowpass/crypto.ts`)
   - Argon2id key derivation function (KDF)
   - AES-256-GCM encryption/decryption
   - HMAC-SHA256 integrity verification
   - Secure random generation (salt, nonce, passwords)

2. **Vault Management** (`src/flowpass/vault-manager.ts`)
   - In-memory Vault structure (Map-based)
   - Serialization/deserialization
   - Automatic site index building
   - Entry CRUD operations
   - Hostname-based matching

3. **Main Process Service** (`src/flowpass/flowpass-service.ts`)
   - FlowPassService singleton
   - Profile-based vault management
   - Auto-lock timer
   - Login capture buffer
   - Never Save hosts management

4. **IPC Communication Layer**
   - 20+ IPC handlers in `src/main/index.ts`
   - Preload API exposure in `src/preload.ts`
   - TypeScript type definitions in `src/renderer/types/global.d.ts`

### ✅ Phase 2: UI Components (Completed)

1. **React Components** (`src/renderer/flowpass/`)
   - `types.ts`: Renderer-side type definitions
   - `useFlowPass.ts`: React hook for state management
   - `FlowPassSettings.tsx`: Complete UI with:
     - Setup wizard for first-time users
     - Unlock screen
     - Vault view with search
     - Entry editor with password generator
     - URL management
     - Custom fields support

2. **Settings Integration**
   - Added "FlowPass" section to Settings window
   - Connected from Passwords section
   - Fully integrated UI

### 📝 Phase 3: Autofill & Content Scripts (To Do)

The following features are planned but not yet implemented:

1. **Content Script Injection**
   - Form detection (password inputs)
   - FlowPass icon injection on focus
   - Credential selection UI
   - Auto-fill functionality

2. **Login Capture**
   - Form submission detection
   - POST request monitoring (SPA support)
   - Toast notification for saving credentials
   - Auto-registration workflow

3. **Import/Export**
   - CSV import with column mapping
   - JSON import
   - Encrypted vault export
   - CSV export with master password verification

4. **Password Audit**
   - Weak password detection (zxcvbn)
   - Reused password detection
   - Old password warnings (90+ days)

## 🔧 Architecture

### File Structure

```
src/
├── flowpass/                       # Backend (Main Process)
│   ├── types.ts                    # Core type definitions
│   ├── crypto.ts                   # Encryption utilities
│   ├── vault-manager.ts            # Vault operations
│   └── flowpass-service.ts         # Main service singleton
│
├── renderer/flowpass/              # Frontend (Renderer Process)
│   ├── types.ts                    # Renderer types
│   ├── useFlowPass.ts              # React hook
│   └── FlowPassSettings.tsx        # UI component
│
├── main/index.ts                   # IPC handlers
├── preload.ts                      # API exposure
└── renderer/types/global.d.ts      # TypeScript definitions
```

### Security Features

1. **Encryption**
   - Master password → Argon2id → 256-bit key
   - Vault encrypted with AES-256-GCM
   - HMAC-SHA256 for integrity verification
   - Secure random generation via Node.js crypto

2. **Memory Safety**
   - Passwords zeroed out on lock
   - Buffer clearing after use
   - No plaintext storage

3. **Auto-lock**
   - Configurable timeout (default: 10 minutes)
   - Automatic locking on idle
   - Manual lock available

## 🚀 Usage

### First Time Setup

1. Open Sylph Settings (Cmd/Ctrl + ,)
2. Navigate to "FlowPass" section
3. Create a strong master password (min. 8 characters)
4. Click "Set Up FlowPass"

### Adding Credentials

1. Unlock FlowPass with master password
2. Click "+ New Entry"
3. Fill in:
   - Name (required)
   - Username
   - Password (with generator)
   - URLs
   - Notes
4. Click "Save Entry" and enter master password

### Managing Entries

- **Search**: Use search bar to filter entries
- **Edit**: Click on any entry to edit
- **Delete**: Click "Delete" in entry editor
- **Lock**: Click "Lock Vault" to secure

## 🔐 Storage Locations

- **Config**: `~/Library/Application Support/Sylph/Profiles/<profileId>/flowpass.config`
- **Vault**: `~/Library/Application Support/Sylph/Profiles/<profileId>/flowpass.vault`

## 📦 Dependencies

- `argon2`: ^0.44.0 - Password hashing
- `papaparse`: ^5.5.3 - CSV parsing (for import)
- `psl`: ^1.15.0 - Public suffix list (for domain matching)
- `zxcvbn`: ^4.4.2 - Password strength estimation
- `uuid`: ^11.1.0 - Unique ID generation

## 🎯 Roadmap Completion

| Feature | Status |
|---------|--------|
| Master password encryption | ✅ Complete |
| Vault CRUD operations | ✅ Complete |
| Settings UI | ✅ Complete |
| Entry editor | ✅ Complete |
| Search & filter | ✅ Complete |
| Auto-lock timer | ✅ Complete |
| Content script autofill | 🔄 Planned |
| Login capture | 🔄 Planned |
| Import/Export | 🔄 Planned |
| Password audit | 🔄 Planned |
| TOTP support | 🔄 Planned |

## 📝 Notes

- FlowPass stores encrypted vaults locally on your device
- Master password is never stored - only used to derive encryption key
- Each profile has its own separate vault
- Vault is automatically locked after configured timeout
- All sensitive operations require master password re-entry

## 🐛 Known Issues

None currently. This is the initial implementation.

## 🤝 Contributing

FlowPass is part of Sylph browser. Follow Sylph's contribution guidelines.
