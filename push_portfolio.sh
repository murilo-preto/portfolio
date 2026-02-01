rsync -av --delete --exclude='.venv/' \
  /home/mpreto/Documents/Github/portfolio/ \
  guaratuba:/home/mpreto/portfolio/ \
&& ssh guaratuba 'cd /home/mpreto/portfolio/docker && ./rebuild.sh'
