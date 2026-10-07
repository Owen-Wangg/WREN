FROM public.ecr.aws/lambda/python:3.12

COPY requirements-feedback-engine.txt .
RUN pip install -r requirements-feedback-engine.txt --target "${LAMBDA_TASK_ROOT}"

COPY wren_engine/ ${LAMBDA_TASK_ROOT}/wren_engine/
COPY handler.py ${LAMBDA_TASK_ROOT}/
COPY publish_debrief_ready.py ${LAMBDA_TASK_ROOT}/

# Drop root for everything after the build steps (checkov: no non-root USER).
# Lambda overrides this with its own least-privileged user at runtime; this
# covers local/other container runs. https://docs.aws.amazon.com/lambda/latest/dg/images-create.html
USER nobody

CMD ["handler.handler"]
