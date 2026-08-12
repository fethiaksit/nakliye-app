# Proje içine kurulan Node.js ve npm'i, repository hangi dizine taşınırsa
# taşınsın aktif terminal için kullanılabilir yapar.
nakliye_frontend_dir="${${(%):-%N}:A:h}"
export PATH="$nakliye_frontend_dir/.node/bin:$PATH"
unset nakliye_frontend_dir
