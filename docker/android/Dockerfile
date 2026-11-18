FROM node:24-bookworm
# Optional organization CAs can be supplied in ca/ when rebuilding behind a TLS proxy
COPY ca/ /usr/local/share/ca-certificates/
RUN update-ca-certificates && apt-get update && apt-get install -y --no-install-recommends ca-certificates-java openjdk-17-jdk-headless unzip \
 && rm -rf /var/lib/apt/lists/* && update-ca-certificates -f
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ANDROID_HOME=/sdk ANDROID_SDK_ROOT=/sdk GRADLE_USER_HOME=/gradle NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
RUN mkdir -p /opt/cmdline-tools && cd /tmp && curl -fsSLo tools.zip https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip \
 && unzip -q tools.zip -d /opt/cmdline-tools && mv /opt/cmdline-tools/cmdline-tools /opt/cmdline-tools/latest && rm tools.zip
ENV PATH=/opt/cmdline-tools/latest/bin:/sdk/platform-tools:$PATH
WORKDIR /work
