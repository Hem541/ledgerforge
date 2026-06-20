# Deploying LedgerForge to AWS EC2

The full stack runs in containers via `docker-compose.prod.yml`. This guide
deploys it to a single EC2 instance for a demo, then tears it down.

> Cost note: on a Free-plan-eligible instance (t3.micro / t2.micro), a few
> hours costs cents and is covered by free credits. **Terminate the instance
> when done** (last section) so nothing keeps running.

## 1. Launch an EC2 instance

In the AWS console:
- Search **EC2** → **Launch instance**
- Name: `ledgerforge-demo`
- AMI: **Amazon Linux 2023** (default)
- Instance type: **t3.micro** (or t2.micro — Free-plan eligible)
- Key pair: **Create a new key pair**, name it `ledgerforge-key`, type RSA,
  format `.pem`. **Download it** — this is how you log in. Save it somewhere
  safe (e.g. `~/Desktop`).
- Network settings → **Allow HTTP traffic from the internet** (check this box).
  Also allow SSH (usually on by default).
- Storage: default (8 GB is fine).
- **Launch instance.**

After a minute, open the instance and copy its **Public IPv4 address**.

## 2. Connect from your Mac

```bash
# lock down the key file's permissions (SSH refuses loose ones)
chmod 400 ~/Desktop/ledgerforge-key.pem

# connect (replace with your instance's public IP)
ssh -i ~/Desktop/ledgerforge-key.pem ec2-user@YOUR_PUBLIC_IP
```

Type `yes` when it asks about authenticity. You're now on the server.

## 3. Install Docker on the instance

```bash
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user
# log out and back in so the group change takes effect
exit
```

Reconnect (same ssh command), then install the compose plugin:

```bash
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version
```

## 4. Get the project onto the server + run it

Easiest is to push your project to GitHub first, then clone it here:

```bash
git clone https://github.com/YOUR_USERNAME/ledgerforge.git
cd ledgerforge
docker compose -f docker-compose.prod.yml up -d --build
```

The build takes a few minutes the first time. Check it's up:

```bash
docker compose -f docker-compose.prod.yml ps
```

All four services (db, redis, api, web) should be running.

## 5. See it live

In your browser: **http://YOUR_PUBLIC_IP**

The dashboard loads, served from AWS. Submit a payment, run the mismatch demo,
take your screenshots. This is your "deployed to AWS" proof.

## 6. TEAR IT DOWN (important)

When you've captured what you need:
- EC2 console → select `ledgerforge-demo` → **Instance state → Terminate**
- Confirm. The instance and its storage are deleted; billing stops.

Nothing else to clean up — a single terminated EC2 instance leaves nothing
running. Verify the instance shows `terminated` and you're done.
