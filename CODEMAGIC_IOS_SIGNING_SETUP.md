# Codemagic iOS Signing Setup (Windows + Apple + Codemagic)

This document captures the exact process that worked for generating iOS signing assets on Windows and configuring Codemagic for iOS App Store builds.

## 1) Generate CSR and Private Key on Windows

Use Git Bash or PowerShell in a working folder.

### 1.1 Create working folder

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\apple-signing" | Out-Null
Set-Location "$env:USERPROFILE\apple-signing"
```

### 1.2 Generate private key (working command)

```bash
openssl genpkey -algorithm RSA -out ios_distribution_private.key -pkeyopt rsa_keygen_bits:2048
```

### 1.3 Generate CSR

If Git Bash rewrites paths, disable path conversion:

```bash
MSYS_NO_PATHCONV=1 openssl req -new -key ios_distribution_private.key -out ios_distribution.csr -subj "/emailAddress=support@seriqcare.com/CN=SeriqCare Distribution/C=MY"
```

Alternative interactive mode (also works):

```bash
openssl req -new -key ios_distribution_private.key -out ios_distribution.csr
```

### 1.4 Verify CSR

```bash
openssl req -in ios_distribution.csr -noout -subject
```

## 2) Create Apple Distribution Certificate in Apple Developer

1. Open Apple Developer portal.
2. Go to Certificates, IDs & Profiles.
3. Open Certificates and click +.
4. Choose Apple Distribution.
5. Upload ios_distribution.csr.
6. Download the resulting certificate file (distribution.cer).

## 3) Convert Certificate and Create P12 on Windows

Place distribution.cer in the same folder, then run:

```bash
openssl x509 -inform DER -in distribution.cer -out distribution.pem
openssl pkcs12 -export -inkey ios_distribution_private.key -in distribution.pem -out ios_distribution.p12 -name "Apple Distribution: SeriqCare"
```

You will be prompted for a password. Save this password because Codemagic needs it.

## 4) Create App Store Provisioning Profile

1. In Apple Developer, go to Profiles and click +.
2. Choose App Store profile type.
3. Select app identifier: com.seriqcare.mobile.
4. Select your Apple Distribution certificate.
5. Generate and download the .mobileprovision profile.

## 5) Add Integrations and Signing Assets in Codemagic

## 5.1 Add App Store Connect API integration

Path:
- Codemagic Team settings
- Integrations
- App Store Connect
- Add integration

Fill these values:
- API key name: care api key (or APP_STORE_CONNECT)
- Issuer ID: your App Store Connect Issuer ID (UUID)
- Key ID: X4SCKQ3V55
- API key: upload the .p8 file

Important:
- If the .p8 file is lost, create a new API key in App Store Connect.

## 5.2 Add certificate identity

Path:
- Codemagic Team settings
- Code signing identities
- Add certificate

Upload:
- ios_distribution.p12
- P12 password

## 5.3 Add provisioning profile

Path:
- Codemagic Team settings
- Provisioning profiles
- Add profile

Upload:
- The App Store .mobileprovision for com.seriqcare.mobile

## 6) Use the Codemagic workflow

This repository contains the workflow file:
- codemagic.yaml

Current workflow expects:
- Bundle identifier: com.seriqcare.mobile
- Distribution type: app_store
- App Store Connect integration name to match the integration configured in Codemagic

## 7) Quick Troubleshooting

If you still see:
- No matching profiles found for bundle identifier com.seriqcare.mobile and distribution type app_store

Check all of the following:
1. App ID exists in Apple Developer: com.seriqcare.mobile
2. Apple Distribution certificate is active
3. App Store provisioning profile exists for com.seriqcare.mobile
4. Codemagic has both uploaded:
   - ios_distribution.p12
   - matching .mobileprovision
5. Codemagic integration uses the correct Apple team and valid API key
6. Any pending Apple agreements are accepted in App Store Connect

## 8) Security Notes

- Never commit .p12, private key, .p8, or .mobileprovision files into Git.
- Store secrets only in Apple portals and CI secret storage.
