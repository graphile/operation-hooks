rm -Rf node_modules/graphile-build node_modules/graphile-build-pg node_modules/postgraphile-core/ node_modules/graphql-parse-resolve-info node_modules/graphql node_modules/pg-sql2 node_modules/postgraphile node_modules/@types/graphql
ln -s ../../postgraphile node_modules/postgraphile
cd node_modules/postgraphile && rm -Rf node_modules/graphile-build node_modules/graphile-build-pg node_modules/postgraphile-core/ node_modules/graphql-parse-resolve-info node_modules/graphql node_modules/pg-sql2
