FROM mysql:8.4

RUN microdnf install -y findutils gzip tar \
    && microdnf clean all

COPY containers/backup/elabftw-backup /usr/local/bin/elabftw-backup
RUN chmod 0555 /usr/local/bin/elabftw-backup

ENTRYPOINT ["/usr/local/bin/elabftw-backup"]
CMD ["backup"]
