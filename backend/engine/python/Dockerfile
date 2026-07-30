FROM public.ecr.aws/lambda/python:3.12

COPY requirements-feedback-engine.txt .
RUN pip install -r requirements-feedback-engine.txt --target "${LAMBDA_TASK_ROOT}"

COPY wren_engine/ ${LAMBDA_TASK_ROOT}/wren_engine/
COPY handler.py ${LAMBDA_TASK_ROOT}/
COPY publish_debrief_ready.py ${LAMBDA_TASK_ROOT}/

CMD ["handler.handler"]
